"""邮局订报数据生成模块 · 导入版本流水（上传→解析→合并→校验→落库，不可变）。

一次上传两份来源即建一个新版本 V_n：
1. 原样落盘两份文件（含 SHA-256）。
2. 解析来源A（全量）+ 来源B（仅 物流=邮局 且 起投月=本批月）。
3. 合并（A 在前、B 追加），按 姓名+电话 去重。
4. 逐行补：cpca 拆 省/市/区 + 地区短名、月数 N=13−起始月、金额=份数×N×20。
5. 三级校验；有 block → validation_failed，否则 validation_passed。
旧版不覆盖；激活新版时旧 active 置 superseded（见 subscription_service.activate_version）。
"""

from decimal import Decimal
from typing import List, Optional, Tuple

import cpca
from sqlalchemy.orm import Session

from app.models import (
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

DEFAULT_REASON = "来源数据修正后重新导入"


def months_for(start_month: int) -> int:
    """邮局订报到当年 12 月底：N = 13 − 起始月。"""
    return 13 - int(start_month)


def _cpca_split(addresses: List[str]) -> List[Tuple[Optional[str], Optional[str], Optional[str]]]:
    """批量拆 省/市/区（保留全名；直辖市 市=省），与黄金样本明细列一致。"""
    if not addresses:
        return []
    df = cpca.transform(addresses)
    out = []
    for i in range(len(addresses)):
        prov = df.iloc[i]["省"] or None
        city = df.iloc[i]["市"] or None
        dist = df.iloc[i]["区"] or None
        if city == "市辖区" and prov:
            city = prov
        out.append((prov, city, dist))
    return out


def _merge_rows(rows_a: List[parser.ParsedRow], rows_b: List[parser.ParsedRow]) -> List[parser.ParsedRow]:
    """A 全量在前 + B 追加（不静默去重；重复由校验层按 §6 阻断，操作员修源后重导）。"""
    return list(rows_a) + list(rows_b)


def create_version(
    db: Session,
    batch: SubscriptionBatch,
    files: List[Tuple[str, str, bytes]],
    *,
    reason: Optional[str] = None,
    operator_id: Optional[int] = None,
) -> SubscriptionImportVersion:
    version = SubscriptionImportVersion(
        batch_id=batch.id,
        version_no=batch_svc.next_version_no(db, batch.id),
        status=SubscriptionImportStatus.parsing,
        reason=(reason or DEFAULT_REASON),
        uploaded_by=operator_id,
    )
    db.add(version)
    db.flush()

    file_a = file_b = None
    for role, filename, content in files:
        stored = attachment_service.store_file(
            f"subscription/{batch.year}-{batch.start_month:02d}", filename, content
        )
        db.add(SubscriptionSourceFile(
            version_id=version.id, file_role=role,
            file_type=(filename.rsplit(".", 1)[-1].lower() if "." in filename else None),
            original_filename=filename, stored_path=stored,
            size=len(content), sha256=attachment_service.sha256_hex(content),
        ))
        if role == "A":
            file_a = (filename, content)
        elif role == "B":
            file_b = (filename, content)

    all_issues: List[dict] = []

    if file_a is None:
        all_issues.append({"level": "block", "source": "A", "code": "missing_file",
                           "message": "缺来源A（订阅明细）", "row_no": None, "field": "", "sheet_or_file": ""})
        pr_a = parser.ParseResult()
    else:
        pr_a = parser.parse_source_a(file_a[1], file_a[0])
        all_issues.extend(_pi(i) for i in pr_a.issues)

    pr_b = parser.ParseResult()
    if file_b is not None:
        pr_b = parser.parse_source_b(file_b[1], file_b[0], batch.year, batch.start_month)
        all_issues.extend(_pi(i) for i in pr_b.issues)

    merged = _merge_rows(pr_a.rows, pr_b.rows)
    N = months_for(batch.start_month)

    # 批量拆地址。
    provs = _cpca_split([r.address or "" for r in merged])
    records: List[SubscriptionRecord] = []
    for row, (prov, city, dist) in zip(merged, provs):
        amount = calc.compute_amount(row.copies, N)
        records.append(SubscriptionRecord(
            version_id=version.id,
            name=row.name or "(未填写)", phone=row.phone or None,
            province=prov, city=city, district=dist,
            address=row.address or None, postal_code=row.postal_code or None,
            copies=int(row.copies) if row.copies else 0, months=N, amount=amount,
            region_name=parser.province_to_region(prov),
            source_channel=row.channel or None,
            remittance_name=row.remittance_name or None,
            remittance_date=row.remittance_date or None,
            source_file_role=row.source_file_role, source_row=row.source_row,
        ))

    all_issues.extend(validator.validate_rows(records))

    for rec in records:
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
        "months": N,
        "from_a": len(pr_a.rows), "from_b": len(pr_b.rows),
        "issue_block": sum(1 for it in all_issues if it["level"] == "block"),
        "issue_warn": sum(1 for it in all_issues if it["level"] == "warn"),
        "issue_info": sum(1 for it in all_issues if it["level"] == "info"),
    }

    if batch.status == SubscriptionBatchStatus.draft:
        batch.status = SubscriptionBatchStatus.pending_validation

    db.commit()
    db.refresh(version)
    return version


def _pi(pi: parser.ParseIssue) -> dict:
    return {
        "level": pi.level, "source": pi.source, "sheet_or_file": pi.sheet_or_file,
        "row_no": pi.row_no, "field": pi.field_name, "code": pi.code, "message": pi.message,
    }
