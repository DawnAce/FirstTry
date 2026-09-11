"""导入核对在服务端草稿上进行；版本检查、重算、提交阻断与原件分离。"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Order, OrderEventType, Product
from app.models.order_item import DeliveryMethod
from app.models.order import OrderCommercialStatus
from app.order_import_cache import get_order_import_session, serialized_import
from app.schemas.order_import_review import ImportReviewIn
from app.services.order_event_logger import log_event

if TYPE_CHECKING:
    from app.services.cbj_order_import_service import PreviewRow


def signature(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def product_signature(product: Product) -> str:
    return signature({column.name: getattr(product, column.name) for column in Product.__table__.columns
                      if column.name not in {"created_at", "updated_at", "notes", "list_price"}})


def validate_products(db: Session, payload: dict) -> None:
    expected = {int(key): value for row in payload["rows"] for key, value in row.get("product_signatures", {}).items()}
    actual = {p.id: product_signature(p) for p in db.query(Product).filter(Product.id.in_(expected)).populate_existing()}
    if actual != expected:
        raise HTTPException(409, "使用的商品配置已变化，请重新预览并核对")


def draft(session_id: str, owner_id: int | None, version: int | None = None) -> dict:
    payload = get_order_import_session(session_id)
    if payload is None:
        raise HTTPException(400, "导入会话已过期，请重新预览 Excel")
    if payload.get("owner_id") != owner_id:
        raise HTTPException(403, "无权操作其他人的导入会话")
    if version is not None and payload.get("version", 1) != version:
        raise HTTPException(409, "导入草稿已变化，请刷新核对内容后重试")
    return payload


def output(payload: dict, session_id: str) -> dict:
    counts = dict.fromkeys(("total", "import", "unresolved", "duplicate", "skip_status"), 0)
    for row in payload["preview_rows"]:
        counts[row["decision"]] = counts.get(row["decision"], 0) + 1
        counts["total"] += 1
    pending = sum(r["status"] == "pending" for row in payload["preview_rows"] if row["decision"] == "import" for r in row.get("reviews", []))
    return {"session_id": session_id, "version": payload.get("version", 1), "counts": counts,
            "can_commit": any(counts.get(k, 0) for k in ("import", "retain", "source_update")) and not pending,
            "pending_review_count": pending, "rows": deepcopy(payload["preview_rows"]),
            "issue_review_options": payload.get("issue_review_options", [])}


def cache_row(row: "PreviewRow", historical: bool) -> dict:
    return {"order_create": row.order_create.model_dump(mode="json"),
            "commercial_status": row.commercial_status.value if row.commercial_status else None,
            "source_status_raw": row.status_raw, "is_historical_archive": historical,
            "issue_reviews": row.issue_reviews, "reviews": row.reviews,
            "product_signatures": row.product_signatures}


@serialized_import
def review(db: Session, session_id: str, request: ImportReviewIn, owner_id: int) -> dict:
    from app.services.cbj_order_import_service import build_import_preview, _serialize_row
    current = draft(session_id, owner_id, request.expected_version)
    validate_products(db, current)
    payload = deepcopy(current)
    number = request.external_order_no
    display = next((r for r in payload["preview_rows"] if r["external_order_no"] == number), None)
    if display is None or display.get("source_id") or display["decision"] in {"retain", "duplicate", "source_update"}:
        raise HTTPException(409, "此记录不适用于新订单核对；已有来源请到来源交易处理")
    correction = payload.setdefault("corrections", {}).setdefault(number, {})
    previous = deepcopy(display)
    old_cache = next((r for r in payload["rows"] if r["order_create"]["external_order_no"] == number), None)
    # 批量补录的日期是真实人工输入，后续投递核对必须保留并重新确认。
    if old_cache:
        for fill in old_cache.get("coverage_fills", []):
            index = fill["item_index"]
            item = old_cache["order_create"]["items"][index]
            correction.setdefault("coverage", {})[str(index)] = [item.get("coverage_start_date"), item.get("coverage_end_date")]
    index = request.item_index
    if request.kind in {"delivery", "coverage"}:
        if index is None or index >= len(display["items"]):
            raise HTTPException(422, "请选择本单的有效明细")
        if request.kind == "delivery":
            if request.value not in {method.value for method in DeliveryMethod} or not display["items"][index]["delivery_method"]:
                raise HTTPException(422, "请选择该明细的有效投递方式")
            correction.setdefault("deliveries", {})[str(index)] = request.value
            correction["confirmed_coverage"] = [key for key in correction.get("confirmed_coverage", []) if key != str(index)]
        else:
            if str(index) not in correction.get("coverage", {}):
                raise HTTPException(422, "本条明细没有需要核对的人工订期")
            correction.setdefault("confirmed_coverage", []).append(str(index))
    elif request.kind == "status":
        if request.value not in {status.value for status in OrderCommercialStatus}:
            raise HTTPException(422, "请选择实际交易状态")
        correction["status"] = request.value
    elif request.kind == "amount":
        if not request.amounts or any(not v.is_finite() or v < 0 or v.as_tuple().exponent < -2 for v in request.amounts):
            raise HTTPException(422, "金额须为非负数，最多两位小数")
        correction["amounts"] = [str(v) for v in request.amounts]
    elif request.kind == "date":
        try:
            correction["date"] = date.fromisoformat(request.value or "").isoformat()
        except ValueError:
            raise HTTPException(422, "请填写有效下单日期 YYYY-MM-DD") from None
    elif request.kind == "product":
        po = payload["parsed"][number]
        if index is None or index >= len(po.product_lines) or po.product_lines[index].is_shipping or request.product_id is None:
            raise HTTPException(422, "请选择原商品行及对应商品")
        correction.setdefault("products", {})[str(index)] = request.product_id
        # 商品拆分结构可能变化，旧的逐明细确认不能复用到新明细。
        for field in ("deliveries", "amounts", "coverage", "confirmed_coverage"):
            correction.pop(field, None)
    rebuilt = build_import_preview(db, [payload["parsed"][number]], payload["settings"],
                                   payload["platform"], payload["store"], {number: correction})
    row = rebuilt.rows[0]
    if row.decision == "duplicate":
        raise HTTPException(409, "此订单已被其他操作导入，请重新预览")
    display.update(_serialize_row(row))
    display["corrected"] = True
    payload["rows"] = [r for r in payload["rows"] if r["order_create"]["external_order_no"] != number]
    audit = payload.setdefault("review_audits", {}).setdefault(number, [])
    audit.append({
            "kind": request.kind, "item_index": index, "reason": request.reason,
            "input": request.model_dump(mode="json", include={"value", "amounts", "product_id"}, exclude_none=True),
            "before": {"commercial_status": previous["commercial_status"], "items": previous["items"],
                       "order_date": previous.get("order_date")},
            "after": {"commercial_status": display["commercial_status"], "items": display["items"],
                      "order_date": display.get("order_date")},
        })
    if row.order_create:
        cached = cache_row(row, payload["mode"] == "historical")
        cached["review_audit"] = deepcopy(audit)
        if old_cache and request.kind != "product":
            cached["coverage_fills"] = old_cache.get("coverage_fills", [])
        payload["rows"].append(cached)
    payload["sources"] = [r for r in payload["sources"] if r["snapshot"]["external_order_no"] != number]
    if row.decision == "import":
        payload["sources"].append({"snapshot": display["source_snapshot"], "kind": "subscription", "expected_revision": None, "decision": "import"})
    if rebuilt.issue_review_options:
        options = {r["issue_number"]: r for r in payload.get("issue_review_options", [])}
        if any(option["issue_number"] in options and options[option["issue_number"]] != option for option in rebuilt.issue_review_options):
            raise HTTPException(409, "刊期表已变化，请重新预览并核对期号")
        options.update({r["issue_number"]: r for r in rebuilt.issue_review_options})
        payload["issue_review_options"] = list(options.values())
    payload["version"] += 1
    payload["requires_version"] = True
    current.clear()
    current.update(payload)
    return output(payload, session_id)


def validate_reviews(payload: dict, expected_version: int | None) -> None:
    if (expected_version is not None or payload.get("requires_version")) and expected_version != payload.get("version", 1):
        raise HTTPException(409, "导入草稿已变化，请刷新后重新核对再提交")
    pending = sum(r["status"] == "pending" for row in payload["rows"] for r in row.get("reviews", []))
    if pending:
        raise HTTPException(409, f"还有 {pending} 项识别结果或人工订期未完成核对，请在预览中处理后再导入")
    for row in payload["rows"]:
        if "reviews" in row and row["commercial_status"] is None:
            raise HTTPException(409, "平台状态尚未确认，不能创建订单")


def log_reviews(db: Session, order: Order, record: dict, operator_id: int | None) -> None:
    for entry in record.get("review_audit", []):
        log_event(db, order_id=order.id, event_type=OrderEventType.modified, operator_id=operator_id,
                  payload={"operation": "import_review", "during_import": True, **entry})
