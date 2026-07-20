"""邮局订报数据生成模块 · 导入版本流水（上传→解析→校验→落库，不可变）。

一次上传两份来源文件即建一个新版本 V_n：
1. 原样落盘两份文件（含 SHA-256）。
2. 解析来源A（明细）+ 来源B（统计汇总）。
3. 逐行补：地址规范化 → 省/市/区/地区、匹配集订分送单位、金额=份数×月数×20。
4. 跑三级校验 + 对账。
5. 落库 records + issues；有 block → validation_failed，否则 validation_passed。
旧版不覆盖；激活新版时旧 active 置 superseded（见 subscription_service.activate_version）。
"""

from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import (
    Partner,
    PartnerType,
    SubscriptionBatch,
    SubscriptionBatchStatus,
    SubscriptionImportStatus,
    SubscriptionImportVersion,
    SubscriptionIssueLevel,
    SubscriptionRecord,
    SubscriptionSourceFile,
    SubscriptionValidationIssue,
)
from app.services import attachment_service
from app.services import subscription_calc_service as calc
from app.services import subscription_parser as parser
from app.services import subscription_service as batch_svc
from app.services import subscription_validation_service as validator
from app.services.address_service import normalize_address

DEFAULT_REASON = "来源数据修正后重新导入"


def _distribution_map(db: Session) -> dict:
    rows = (
        db.query(Partner.name, Partner.id)
        .filter(Partner.partner_type == PartnerType.distribution)
        .all()
    )
    return {name: pid for name, pid in rows}


def _enrich(row: parser.ParsedRow, dist_map: dict, unit_price) -> SubscriptionRecord:
    """补地址规范化 / 地区 / 投递单位 / 金额，落成 SubscriptionRecord（未落库）。"""
    province, city, district, address = row.province, row.city, row.district, row.address
    if not (province or city or district) and address:
        try:
            parsed = normalize_address(address)
            province = parsed.get("province") or None
            city = parsed.get("city") or None
            district = parsed.get("district") or None
            address = parsed.get("address") or address
        except Exception:  # noqa: BLE001 地址库偶发异常不阻断
            pass
    region_name = row.region or province or None
    dist_id = None
    unit_hint = row.distribution_unit or (f"{province}集订分送" if province else "")
    if unit_hint:
        dist_id = dist_map.get(unit_hint)

    price = unit_price if unit_price else calc.DEFAULT_PRICE_PER_COPY_MONTH
    amount = calc.compute_amount(row.copies, row.months, price)

    rec = SubscriptionRecord(
        name=row.name or "(未填写)",
        phone=row.phone or None,
        province=province, city=city, district=district,
        address=address or None, postal_code=row.postal_code or None,
        copies=int(row.copies) if row.copies else 0,
        months=int(row.months) if row.months else None,
        amount=amount,
        region_name=region_name,
        distribution_unit_id=dist_id,
        source_file_role=row.source_file_role,
        source_row=row.source_row,
        excluded=row.excluded,
        exclude_reason=row.exclude_reason or None,
    )
    # 校验用属性挂到对象上（region_name/province/phone 已在字段上）。
    return rec


def create_version(
    db: Session,
    batch: SubscriptionBatch,
    files: List[Tuple[str, str, bytes]],  # [(role 'A'/'B', filename, content), ...]
    *,
    reason: Optional[str] = None,
    operator_id: Optional[int] = None,
) -> SubscriptionImportVersion:
    """建新导入版本并跑完解析+校验流水（同事务落库）。"""
    version = SubscriptionImportVersion(
        batch_id=batch.id,
        version_no=batch_svc.next_version_no(db, batch.id),
        status=SubscriptionImportStatus.parsing,
        reason=(reason or DEFAULT_REASON),
        uploaded_by=operator_id,
    )
    db.add(version)
    db.flush()  # 拿 version.id

    # 1. 落盘两份来源文件（含 SHA-256）。
    file_a = file_b = None
    for role, filename, content in files:
        stored = attachment_service.store_file(
            f"subscription/{batch.year}-{batch.start_month:02d}", filename, content
        )
        sf = SubscriptionSourceFile(
            version_id=version.id, file_role=role,
            file_type=(filename.rsplit(".", 1)[-1].lower() if "." in filename else None),
            original_filename=filename, stored_path=stored,
            size=len(content), sha256=attachment_service.sha256_hex(content),
        )
        db.add(sf)
        if role == "A":
            file_a = (filename, content)
        elif role == "B":
            file_b = (filename, content)

    all_issues: List[dict] = []

    # 2. 解析。
    if file_a is None:
        all_issues.append({"level": "block", "source": "A", "sheet_or_file": "", "row_no": None,
                           "field": "", "code": "missing_file", "message": "缺来源A（订阅明细）"})
        pr_a = parser.ParseResult()
    else:
        pr_a = parser.parse_source_a(file_a[1], file_a[0])
    summary_b = {}
    if file_b is not None:
        pr_b = parser.parse_source_b(file_b[1], file_b[0])
        summary_b = pr_b.summary_b
        all_issues.extend(_pi_to_dict(i) for i in pr_b.issues)
    all_issues.extend(_pi_to_dict(i) for i in pr_a.issues)

    # 3. 逐行补全 → records。
    dist_map = _distribution_map(db)
    records = [_enrich(r, dist_map, batch.unit_price) for r in pr_a.rows]

    # 4. 校验（在 records 上跑，records 已含 copies/months/region_name/province/phone）。
    all_issues.extend(validator.validate_rows(records, summary_b))

    # 5. 落库 records + issues。
    for rec in records:
        rec.version_id = version.id
        db.add(rec)
    for it in all_issues:
        db.add(SubscriptionValidationIssue(
            version_id=version.id,
            level=SubscriptionIssueLevel(it["level"]),
            source=it.get("source"), sheet_or_file=it.get("sheet_or_file"),
            row_no=it.get("row_no"), field=it.get("field"), code=it.get("code"),
            message=it["message"],
        ))

    has_block = any(it["level"] == "block" for it in all_issues)
    version.status = (
        SubscriptionImportStatus.validation_failed if has_block
        else SubscriptionImportStatus.validation_passed
    )
    summary = calc.summarize(records)
    version.summary_json = {
        "total_count": summary["total_count"],
        "total_copies": summary["total_copies"],
        "total_amount": str(summary["total_amount"]),
        "region_count": summary["region_count"],
        "issue_block": sum(1 for it in all_issues if it["level"] == "block"),
        "issue_warn": sum(1 for it in all_issues if it["level"] == "warn"),
        "issue_info": sum(1 for it in all_issues if it["level"] == "info"),
    }

    if batch.status == SubscriptionBatchStatus.draft:
        batch.status = SubscriptionBatchStatus.pending_validation

    db.commit()
    db.refresh(version)
    return version


def _pi_to_dict(pi: parser.ParseIssue) -> dict:
    return {
        "level": pi.level, "source": pi.source, "sheet_or_file": pi.sheet_or_file,
        "row_no": pi.row_no, "field": pi.field_name, "code": pi.code, "message": pi.message,
    }
