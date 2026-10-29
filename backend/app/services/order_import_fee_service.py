"""独立运费的导入草稿关联，复用来源关联的校验、版本和审计。"""
from copy import deepcopy
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.order_source import OrderSource
from app.models import Order, OrderItem, FulfillmentTarget, FulfillmentAllocation
from app.models.order_source import OrderSourceLink
from app.schemas.order_source import DeliveryArrangementIn
from app.services.order_delivery_policy import candidate_options, fee_arrangement_available
from app.models.order_item import OrderItemStatus
from app.services import order_source_delivery_service as delivery
from app.services import order_source_arrangement_service as arrangements
from app.order_import_cache import serialized_import
from app.schemas.order_import_review import ImportFeeLinksIn
from app.schemas.order_source import SourceAllocationIn, SourceLinkIn
from app.services.order_import_review_service import draft, output, signature
from app.services.order_source_service import candidates_for_source, link_source, normalize, target_version, validate_links


def source_for(payload: dict, number: str) -> tuple[OrderSource, dict]:
    record = next((r for r in payload["sources"] if r["snapshot"]["external_order_no"] == number), None)
    if record is None or record["kind"] != "shipping_fee" or record["decision"] != "retain" or record.get("expected_revision") is not None:
        raise HTTPException(409, "此入口仅处理本批新运费；已有运费请在来源交易核对关联")
    snap = record["snapshot"]
    return OrderSource(kind="shipping_fee", paid_amount=Decimal(snap["paid_amount"]),
                       recipient_name=normalize(snap["recipient_name"]), recipient_phone=normalize(snap["recipient_phone"]),
                       recipient_address=normalize(snap["recipient_address"]),
                       order_date=date.fromisoformat(snap["order_date"]) if snap["order_date"] else None,
                       commercial_status=snap.get("commercial_status"), lock_version=1,
                       finance_review_required=False), snap


def draft_context(record: dict, raw: dict, contact: dict) -> tuple:
    order = Order(status="active", commercial_status=record.get("commercial_status"),
                  is_historical_archive=record.get("is_historical_archive", False))
    item = OrderItem(**{key: value for key, value in raw.items() if key in OrderItem.__table__.columns})
    for field in ("coverage_start_date", "coverage_end_date"):
        value = getattr(item, field)
        if isinstance(value, str):
            setattr(item, field, date.fromisoformat(value))
    target = FulfillmentTarget(**contact)
    target.status = "active"
    item.status = item.status or OrderItemStatus.active
    return order, item, target, FulfillmentAllocation(version_no=1)


def draft_targets(payload: dict) -> dict[str, tuple[dict, dict, dict]]:
    targets = {}
    for row in payload["rows"]:
        for index, item in enumerate(row["order_create"]["items"]):
            if item["fulfillment_type"] == "subscription" and len(item.get("targets", [])) == 1:
                targets[f'{row["order_create"]["external_order_no"]}#{index}'] = (row, item, item["targets"][0])
    return targets


@serialized_import
def candidates(db: Session, session_id: str, number: str, owner_id: int, search: str | None = None) -> dict:
    payload = draft(session_id, owner_id)
    source, snapshot = source_for(payload, number)
    existing = candidates_for_source(db, source, snapshot, search)
    rows = existing["rows"]
    # 推荐先展示待导入的同批订阅；不会创建临时订单来获得数据库 ID。
    product_names = " ".join(line["name"] for line in snapshot["product_lines"])
    batch = []
    draft_values = draft_targets(payload)
    contexts = {key: draft_context(*value) for key, value in draft_values.items()}
    options = candidate_options(db, [(o, i, t) for o, i, t, _ in contexts.values()]) if fee_arrangement_available(source) else {}
    for key, (record, item, target) in draft_values.items():
        order = record["order_create"]
        fields = ["recipient_name", "recipient_phone", "recipient_address"]
        matches = [bool(getattr(source, field)) and normalize(target.get(field)) == getattr(source, field) for field in fields]
        if search:
            if normalize(search) not in normalize(" ".join(str(order.get(field) or "") for field in ("external_order_no", "payer_name")) + " " + " ".join(str(target.get(field) or "") for field in fields)):
                continue
        elif not any(matches):
            continue
        publication = "cbj" if "中国经营报" in product_names else "business_school" if "商学院" in product_names else None
        if publication and item["publication"] != publication:
            continue
        covered = bool(source.order_date and item.get("coverage_start_date") and item.get("coverage_end_date") and
                       item["coverage_start_date"] <= source.order_date.isoformat() <= item["coverage_end_date"])
        before = bool(source.order_date and order["order_date"] <= source.order_date.isoformat())
        review_pending = any(r["status"] == "pending" for r in record.get("reviews", []))
        high = all(matches) and covered and before and not review_pending and record["commercial_status"] not in {None, "refunded", "cancelled"}
        batch.append({"draft_key": key, "order_id": None, "order_item_id": None, "target_id": None,
                      "order_code": None, "external_order_no": order["external_order_no"], "order_date": order["order_date"],
                      "publication": item["publication"], **{field: target.get(field) for field in fields},
                      "coverage_start_date": item.get("coverage_start_date"), "coverage_end_date": item.get("coverage_end_date"),
                      "delivery_options": options.get(id(contexts[key][2])),
                      "confidence": "possible", "_high_match": high, "expected_target_version": signature(record),
                      "evidence": ["本批待导入订阅"] + [f"{label}{'一致' if match else '不同或缺失'}" for label, match in zip(("姓名", "电话", "地址"), matches)]
                      + ["补费日期在订期内" if covered else "订期不覆盖补费日期或未补齐"]
                      + (["主订阅尚有待核对项"] if review_pending else [])})
    rows = batch + rows
    # 两个来源候选集合合并后重新判断唯一性，截断时不宣称唯一。
    high = [row for row in rows if row.pop("_high_match", False)]
    truncated = existing["truncated"] or len(rows) > 100
    for row in rows:
        row["confidence"] = "possible"
    if len(high) == 1 and not truncated:
        high[0]["confidence"] = "high"
    return {"rows": rows[:100], "truncated": truncated,
            "allocations": payload.get("fee_links", {}).get(number, {}).get("allocations", [])}


def validate_selection(db: Session, payload: dict, number: str, selection: dict, *, refresh: bool = False,
                       require_confirmation: bool = True) -> list[dict]:
    source, _ = source_for(payload, number)
    allocations = selection["allocations"]
    keys = [a.get("draft_key") or f'target:{a.get("target_id")}' for a in allocations]
    if len(keys) != len(set(keys)):
        raise HTTPException(422, "同一订阅收件目标不能重复分配")
    if allocations and sum((Decimal(a["amount"]) for a in allocations), Decimal("0")) != source.paid_amount:
        raise HTTPException(422, "分配金额合计必须等于原运费付款额")
    targets = draft_targets(payload)
    existing = []
    for allocation in allocations:
        if allocation.get("draft_key"):
            target = targets.get(allocation["draft_key"])
            if target is None or signature(target[0]) != allocation["expected_target_version"]:
                raise HTTPException(409, "本批关联订阅已变化，请重新查找并核对运费归属")
        else:
            existing.append(SourceAllocationIn(**{k: allocation[k] for k in ("order_id", "order_item_id", "target_id", "amount", "expected_target_version")}))
    if existing:
        source.paid_amount = sum((a.amount for a in existing), Decimal("0"))
        validate_links(db, source, SourceLinkIn(version=1, reason=selection["reason"], allocations=existing), lock=True)
    source, _ = source_for(payload, number)
    virtual = [OrderSourceLink(order_id=a.get("order_id"), order_item_id=a.get("order_item_id"),
        target_id=a.get("target_id"), amount=Decimal(a["amount"]), refund_amount=None, active=1) for a in allocations]
    reviews = []
    for entry, link in zip(allocations, virtual):
        if not entry.get("delivery"):
            continue
        plan = DeliveryArrangementIn.model_validate(entry["delivery"])
        if entry.get("draft_key"):
            order, item, target, allocation = draft_context(*targets[entry["draft_key"]])
            if (order.is_historical_archive or order.commercial_status in {"refunded", "cancelled"}
                    or item.publication != "cbj" or item.publication_format != "paper"):
                raise HTTPException(409, "此投递安排适用于有效、非历史归档的中国经营报纸刊订阅")
        else:
            # 新运费尚未落库；目标与版本已由 validate_links 锁定并核对。
            order = db.get(Order, entry["order_id"])
            item = db.get(OrderItem, entry["order_item_id"])
            target = db.get(FulfillmentTarget, entry["target_id"])
            allocation = db.get(FulfillmentAllocation, target.allocation_id)
            if order.is_historical_archive:
                raise HTTPException(409, "历史归档订单只留存费用，不能在此安排转投")
        if (order.commercial_status in {"refunded", "cancelled"} or item.publication != "cbj"
                or item.publication_format != "paper"):
            raise HTTPException(409, "此投递安排适用于有效的中国经营报纸刊订阅")
        if (order.status != "active" or item.status != "active" or target.status != "active"
                or target.replaced_by_target_id is not None or allocation.effective_until_issue is not None):
            raise HTTPException(409, "订阅或收件目标已换版，请重新核对投递安排")
        request = arrangements.delivery_request(db, source, link, plan, selection["reason"], item)
        review = delivery.preview(db, 0, request, True,
            context=(source, link, order, item, target, allocation), links_override=virtual)
        if require_confirmation and not plan.postal_confirmed:
            raise HTTPException(422, "请核对投递范围及邮局实际安排")
        if not refresh and plan.expected_state != review["expected_state"]:
            raise HTTPException(409, "投递范围或邮局记录已变化，请重新核对运费关联")
        entry["delivery"]["expected_state"] = review["expected_state"]
        reviews.append({**review, "draft_key": entry.get("draft_key")})
    return reviews


@serialized_import
def preview_links(db: Session, session_id: str, request: ImportFeeLinksIn, owner_id: int) -> dict:
    payload = draft(session_id, owner_id, request.expected_version)
    selection = {"reason": request.reason, "allocations": [a.model_dump(mode="json", exclude_none=True) for a in request.allocations]}
    reviews = validate_selection(db, payload, request.external_order_no, selection, refresh=True, require_confirmation=False)
    return {"allocations": selection["allocations"], "delivery_previews": reviews}


@serialized_import
def save_links(db: Session, session_id: str, request: ImportFeeLinksIn, owner_id: int) -> dict:
    current = draft(session_id, owner_id, request.expected_version)
    payload = deepcopy(current)
    selection = {"reason": request.reason, "allocations": [a.model_dump(mode="json", exclude_none=True) for a in request.allocations]}
    validate_selection(db, payload, request.external_order_no, selection)
    payload.setdefault("fee_links", {})[request.external_order_no] = selection
    for row in payload["preview_rows"]:
        if row["external_order_no"] == request.external_order_no:
            row["fee_link_count"] = len(selection["allocations"])
    payload["version"] += 1
    payload["requires_version"] = True
    current.clear()
    current.update(payload)
    return output(payload, session_id)


def validate_fee_links(db: Session, payload: dict) -> None:
    for number, selection in payload.get("fee_links", {}).items():
        validate_selection(db, payload, number, selection)


def apply_fee_links(db: Session, source: OrderSource, selection: dict, created: dict, operator_id: int | None) -> None:
    allocations = []
    for entry in selection["allocations"]:
        value = dict(entry)
        key = value.pop("draft_key", None)
        if key:
            number, _, index = key.rpartition("#")
            order = created.get(number)
            if order is None:
                raise HTTPException(409, "关联的本批订阅未能新建，请重新预览并选择已有订阅")
            item = sorted(order.items, key=lambda item: item.id)[int(index)]
            allocation = max(item.allocations, key=lambda allocation: allocation.version_no)
            if len(allocation.targets) != 1:
                raise HTTPException(409, "本批订阅收件目标已变化，请重新关联")
            target = allocation.targets[0]
            value.update(order_id=order.id, order_item_id=item.id, target_id=target.id,
                         expected_target_version=target_version(order, item, target))
        allocations.append(SourceAllocationIn(**value))
    if allocations:
        request = SourceLinkIn(version=source.lock_version, reason=selection["reason"], allocations=allocations)
        if any(value.delivery is not None for value in allocations):
            review = arrangements.preview_links(db, source.id, request)
            request.allocations = review["allocations"]
            arrangements.save_links(db, source.id, request, operator_id)
        else:
            link_source(db, source.id, request, operator_id)
