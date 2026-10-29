"""逐期需求只在人工确认后可被采用；采用是替换对应报数项，不是追加。"""
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json

from fastapi import HTTPException

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.cache import invalidate_overview_cache
from app.models import (ChannelDemand, ChannelDemandLine, ChannelDemandAttachment,
    ChannelDemandAdoption, ChannelDemandProfile, Contract, Issue, IssueStatus, Partner,
    PublicationSchedule, PublicationScheduleUpload, ReportEntry, ReportItemTemplate, ReportSourceItem, User)
from app.schemas.channel_demand import DemandIn, DemandOut, PrintPreviewOut, PrintPreviewRow
from app.services.operation_log_service import record_operation


def digest(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def get_demand(db: Session, demand_id: int, *, lock: bool = False) -> ChannelDemand:
    query = db.query(ChannelDemand).options(selectinload(ChannelDemand.lines), selectinload(ChannelDemand.attachments), joinedload(ChannelDemand.partner))
    if lock:
        query = db.query(ChannelDemand).options(joinedload(ChannelDemand.lines), joinedload(ChannelDemand.attachments), joinedload(ChannelDemand.partner)).with_for_update().populate_existing()
    result = query.filter(ChannelDemand.id == demand_id).first()
    if result is None:
        raise HTTPException(404, "机构／渠道需求不存在")
    return result


def output(doc: ChannelDemand) -> DemandOut:
    estimated_amount = None
    if doc.document_type == "order" and doc.pricing:
        estimated_amount = sum((line.unit_price * line.quantity for line in doc.lines
            if line.review_status == "confirmed" and line.unit_price is not None and line.quantity is not None), Decimal("0.00"))
    return DemandOut(**{name: getattr(doc, name) for name in DemandOut.model_fields
        if name not in {"partner_name", "estimated_amount"}}, partner_name=doc.partner.name, estimated_amount=estimated_amount)


def options(db: Session) -> dict:
    partners = db.query(Partner).filter(Partner.active.is_(True)).order_by(Partner.name).all()
    templates = db.query(ReportItemTemplate).order_by(ReportItemTemplate.sort_order).all()
    profiles = {p.partner_id: p for p in db.query(ChannelDemandProfile).all()}
    partner_options = []
    for p in partners:
        profile = profiles.get(p.id)
        chengdu = bool(profile and profile.pricing_policy == "chengdu_annual")
        partner_options.append(dict(id=p.id, name=p.name, display_name=profile.display_name if profile else p.name,
            legal_name=profile.legal_name if profile and profile.legal_name else p.name,
            category=profile.category if profile else None, cycle="month" if chengdu else "week" if profile else "custom",
            document_type="report" if profile and not chengdu else "order", transport="zto" if chengdu else "pending", chengdu=chengdu))
    contracts = db.query(Contract).filter(Contract.status != "void").order_by(Contract.id.desc()).limit(1000).all()
    return {"partners": partner_options,
        "contracts": [dict(id=c.id, partner_id=c.partner_id, title=c.contract_no or c.title) for c in contracts],
        "templates": [dict(category=t.category, sub_category=t.sub_category, display_name=t.display_name) for t in templates]}



def annual_pricing(db: Session, year: int, *, lock: bool = False) -> dict:
    query = db.query(PublicationSchedule).filter(PublicationSchedule.year == year).order_by(PublicationSchedule.publish_date)
    rows = (query.with_for_update().populate_existing() if lock else query).all()
    published = [r for r in rows if not r.is_suspended and r.issue_number is not None]
    if not published or any(not r.is_suspended and r.issue_number is None for r in rows) or len({r.issue_number for r in published}) != len(published):
        raise HTTPException(422, f"{year}年正式刊期缺失或期号重复，请先核对年度刊期表")
    upload_query = db.query(PublicationScheduleUpload).filter(
        PublicationScheduleUpload.year == year, PublicationScheduleUpload.status == "committed"
    ).order_by(PublicationScheduleUpload.id.desc())
    upload = (upload_query.with_for_update().populate_existing() if lock else upload_query).first()
    declared = (upload.summary_json or {}).get("published_count") if upload else None
    if declared is not None and declared != len(published):
        raise HTTPException(422, f"{year}年刊期数量与年度刊期表确认记录不一致")
    if declared is None:
        raise HTTPException(422, f"{year}年缺少年度刊期确认记录，请先核对并导入正式年度刊期表")
    count = len(published)
    price = (Decimal("240") / count * Decimal("0.48")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return dict(year=year, annual_price="240.00", issue_count=count, discount="0.48", unit_price=str(price),
        schedule_fingerprint=digest([(r.issue_number, r.publish_date, r.is_suspended) for r in rows]))


def _prepared(db: Session, data: DemandIn) -> tuple[Partner, list[ChannelDemandLine], dict | None]:
    partner = db.query(Partner).filter(Partner.id == data.partner_id, Partner.active.is_(True)).first()
    if partner is None:
        raise HTTPException(422, "机构不存在或已停用，请先在合作渠道中维护")
    if data.contract_id is not None:
        contract = db.query(Contract).filter(Contract.id == data.contract_id).first()
        if contract is None or contract.partner_id != partner.id or contract.status.value == "void":
            raise HTTPException(422, "合同不存在、已作废或不属于当前机构")
    profile = db.get(ChannelDemandProfile, partner.id)
    if profile and data.category != profile.category:
        raise HTTPException(422, "该机构的印数归属与现有业务口径不一致")
    if profile and profile.pricing_policy == "chengdu_annual" and data.transport != "zto":
        raise HTTPException(422, "成都需求按每期中通寄送，请选择中通；运费由报社承担")
    subs = {r[0] for r in db.query(ReportItemTemplate.sub_category).filter(ReportItemTemplate.category == data.category).all()}
    if not subs:
        raise HTTPException(422, "未配置对应印数模板，请先维护模板")
    numbers = {line.issue_number for line in data.lines}
    schedules = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number.in_(numbers), PublicationSchedule.is_suspended.is_(False)).all()
    by_number = {s.issue_number: s for s in schedules}
    if len(schedules) != len(numbers):
        raise HTTPException(422, "刊期缺失、休刊或期号重复，请从正式刊期表重新选择")
    pricing: dict | None = None
    if data.pricing_mode == "chengdu_annual":
        if not profile or profile.pricing_policy != "chengdu_annual" or data.document_type != "order":
            raise HTTPException(422, "成都年度折算仅适用于成都订货单")
        pricing = {str(y): annual_pricing(db, y) for y in sorted({s.year for s in schedules})}
    keys = set()
    lines = []
    for line in data.lines:
        key = (line.issue_number, line.sub_category)
        if key in keys or line.sub_category not in subs:
            raise HTTPException(422, "存在重复刊期分项或未知印数分项")
        keys.add(key)
        schedule = by_number[line.issue_number]
        quantity = 0 if line.review_status == "none" else line.quantity
        lines.append(ChannelDemandLine(issue_number=line.issue_number, publish_date=schedule.publish_date,
            sub_category=line.sub_category, quantity=quantity, review_status=line.review_status,
            unit_price=Decimal(pricing[str(schedule.year)]["unit_price"]) if pricing else None))
    # 每个刊期必须完整保留该渠道的所有分项，不能以缺行替代待确认。
    for number in numbers:
        if {l.sub_category for l in lines if l.issue_number == number} != subs:
            raise HTTPException(422, f"第{number}期的渠道分项不完整，请补齐或标记待确认")
    return partner, lines, pricing


def save_demand(db: Session, data: DemandIn, user: User, demand_id: int | None = None) -> ChannelDemand:
    partner, lines, pricing = _prepared(db, data)
    doc = get_demand(db, demand_id, lock=True) if demand_id else ChannelDemand(created_by=user.id)
    if demand_id and (doc.status != "draft" or doc.version != data.version):
        raise HTTPException(409, "需求已确认或版本已变化，请刷新；已确认需求请使用更正版本")
    if demand_id and doc.attachments and (doc.partner_id != data.partner_id or doc.category != data.category):
        raise HTTPException(409, "已有凭证的需求不能更换机构或印数归属，请新建需求")
    before = {"version": doc.version, "lines": [dict(issue=l.issue_number, sub=l.sub_category, quantity=l.quantity, status=l.review_status) for l in doc.lines]} if demand_id else None
    for field in ("partner_id", "contract_id", "document_type", "cycle", "received_date", "category", "transport", "recipient_name", "recipient_phone", "recipient_address", "notes"):
        setattr(doc, field, getattr(data, field))
    profile = db.get(ChannelDemandProfile, partner.id)
    doc.display_name = profile.display_name if profile else partner.name
    doc.pricing = pricing
    if demand_id:
        doc.lines.clear()
        db.flush()  # avoid unique-key overlap while replacing draft rows
    doc.lines = lines
    doc.version = doc.version + 1 if demand_id else 1
    doc.status = "draft"
    db.add(doc)
    db.flush()
    record_operation(db, user=user, table_name="channel_demands", record_id=doc.id,
        record_name=f"机构需求-{doc.id}", action="save_channel_demand",
        changes={"before": before, "version": doc.version, "line_count": len(lines)})
    db.commit()
    invalidate_overview_cache()
    return get_demand(db, doc.id)


def confirm_demand(db: Session, demand_id: int, version: int, reviewed: bool, user: User) -> ChannelDemand:
    doc = get_demand(db, demand_id, lock=True)
    if doc.status == "confirmed" and doc.version == version:
        return doc
    if doc.status != "draft" or doc.version != version:
        raise HTTPException(409, "需求版本已变化，请刷新后重新核对")
    if not reviewed:
        raise HTTPException(422, "必须人工核对订数、刊期和凭证后再确认")
    partner = db.query(Partner).filter(Partner.id == doc.partner_id).with_for_update().first()
    if not partner.active:
        raise HTTPException(409, "机构已停用")
    numbers = sorted({l.issue_number for l in doc.lines})
    schedules = db.query(PublicationSchedule).filter(PublicationSchedule.issue_number.in_(numbers)).order_by(PublicationSchedule.id).with_for_update().all()
    dates = {s.issue_number: s.publish_date for s in schedules if not s.is_suspended}
    if len(schedules) != len(numbers) or len(dates) != len(numbers) or any(dates.get(l.issue_number) != l.publish_date for l in doc.lines):
        raise HTTPException(409, "正式刊期已变化，请重新保存并核对需求")
    issues = db.query(Issue).filter(Issue.issue_number.in_(numbers)).order_by(Issue.issue_number).with_for_update().all()
    locked_numbers = {i.issue_number for i in issues if i.status != IssueStatus.draft}
    if locked_numbers:
        if not doc.supersedes_id:
            raise HTTPException(409, "包含已锁定刊期；请保留原印数，追加补发通过现有调整流程处理")
        previous_locked = get_demand(db, doc.supersedes_id, lock=True)
        def frozen_lines(lines: list[ChannelDemandLine]) -> dict:
            return {(l.issue_number, l.sub_category): (l.publish_date, l.quantity, l.review_status, l.unit_price)
                    for l in lines if l.issue_number in locked_numbers}
        if frozen_lines(doc.lines) != frozen_lines(previous_locked.lines):
            raise HTTPException(409, "已锁定刊期的数量、状态和价格必须保持原版本；仅可更正未来未锁定刊期")
    if not any(l.review_status != "pending" for l in doc.lines):
        raise HTTPException(422, "没有已核对明细，不能确认")
    if doc.pricing:
        for year, stored in doc.pricing.items():
            if annual_pricing(db, int(year), lock=True) != stored:
                raise HTTPException(409, "年度刊期或计价依据已变化，请重新保存并核对")
    conflicts = db.query(ChannelDemandLine.issue_number, ChannelDemandLine.sub_category).join(ChannelDemand, ChannelDemand.id == ChannelDemandLine.demand_id).filter(
        ChannelDemand.partner_id == doc.partner_id, ChannelDemand.category == doc.category,
        ChannelDemand.status == "confirmed", ChannelDemand.id != (doc.supersedes_id or -1),
        ChannelDemandLine.issue_number.in_(numbers)).with_for_update().all()
    if set(conflicts) & {(l.issue_number, l.sub_category) for l in doc.lines}:
        raise HTTPException(409, "同机构、同刊期分项已有有效需求，请更正原单，不能重复建基础需求")
    if doc.supersedes_id:
        previous = get_demand(db, doc.supersedes_id, lock=True)
        if previous.status != "confirmed":
            raise HTTPException(409, "原需求已被其他版本更正，请刷新")
        if {(l.issue_number, l.sub_category) for l in previous.lines} != {(l.issue_number, l.sub_category) for l in doc.lines}:
            raise HTTPException(409, "更正版本必须保留原刊期与分项，可用明确不订将数量更正为零")
        if previous.partner_id != doc.partner_id or previous.category != doc.category or previous.document_type != doc.document_type:
            raise HTTPException(409, "更正版本不能改变原机构、印数归属或单据类型")
        previous.status = "superseded"
    db.flush()
    doc.status = "confirmed"
    doc.confirmed_by = user.id
    doc.confirmed_at = datetime.now()
    for attachment in doc.attachments:
        attachment.reviewed_version = doc.version
    record_operation(db, user=user, table_name="channel_demands", record_id=doc.id,
        action="confirm_channel_demand", record_name=f"机构需求-{doc.id}",
        changes={"version": doc.version, "supersedes_id": doc.supersedes_id,
            "pending": sum(l.review_status == "pending" for l in doc.lines)})
    db.commit()
    invalidate_overview_cache()
    return get_demand(db, doc.id)


def revise_demand(db: Session, demand_id: int, version: int, user: User) -> ChannelDemand:
    old = get_demand(db, demand_id, lock=True)
    if old.status != "confirmed" or old.version != version:
        raise HTTPException(409, "只能为当前有效的已确认需求创建更正版本")
    data = DemandIn(**{k: getattr(old, k) for k in DemandIn.model_fields if k not in {"lines", "pricing_mode"}},
        pricing_mode="chengdu_annual" if old.pricing else "unpriced",
        lines=[dict(issue_number=l.issue_number, sub_category=l.sub_category, quantity=l.quantity, review_status=l.review_status) for l in old.lines])
    # 原单保持有效，直到更正版本通过人工确认。
    partner, lines, pricing = _prepared(db, data)
    new = ChannelDemand(**{k: getattr(data, k) for k in ("partner_id", "contract_id", "document_type", "cycle", "received_date", "category", "transport", "recipient_name", "recipient_phone", "recipient_address", "notes")},
        display_name=old.display_name, supersedes_id=old.id, version=1, status="draft", created_by=user.id, pricing=pricing)
    new.lines = lines
    new.attachments = [ChannelDemandAttachment(filename=a.filename, stored_path=a.stored_path, sha256=a.sha256, extraction=a.extraction) for a in old.attachments]
    db.add(new)
    db.flush()
    record_operation(db, user=user, table_name="channel_demands", record_id=new.id,
        action="revise_channel_demand", changes={"supersedes_id": old.id})
    db.commit()
    return get_demand(db, new.id)


def demand_groups(db: Session, issue_number: int, *, lock: bool = False) -> dict:
    query = db.query(ChannelDemand, ChannelDemandLine).join(ChannelDemandLine, ChannelDemandLine.demand_id == ChannelDemand.id).filter(
        ChannelDemand.status == "confirmed", ChannelDemandLine.issue_number == issue_number
    ).order_by(ChannelDemand.id, ChannelDemandLine.id)
    rows = (query.with_for_update().populate_existing() if lock else query).all()
    groups: dict = defaultdict(list)
    for doc, line in rows:
        groups[(doc.category, line.sub_category)].append(dict(demand_id=doc.id, version=doc.version,
            partner_id=doc.partner_id, display_name=doc.display_name, line_id=line.id,
            quantity=line.quantity, review_status=line.review_status))
    return dict(groups)


def print_preview(db: Session, issue_id: int, *, lock: bool = False) -> PrintPreviewOut:
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(404, "刊期不存在")
    entry_query = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id)
    entries = {(e.category, e.sub_category): e.value for e in (entry_query.with_for_update().populate_existing() if lock else entry_query).all()}
    adoption_query = db.query(ChannelDemandAdoption).filter(ChannelDemandAdoption.issue_number == issue.issue_number)
    adoptions = {(a.category, a.sub_category): a for a in (adoption_query.with_for_update().populate_existing() if lock else adoption_query).all()}
    source_query = db.query(ReportSourceItem).filter(
        ReportSourceItem.issue_number == issue.issue_number, ReportSourceItem.effect_status == "active",
        ReportSourceItem.source_action.in_(["base", "prepress_addition"]))
    existing_sources = {(r.category, r.sub_category) for r in (source_query.with_for_update().populate_existing() if lock else source_query).all()}
    rows = []
    groups = demand_groups(db, issue.issue_number, lock=lock)
    for key, sources in sorted(groups.items()):
        errors = []
        if any(s["review_status"] == "pending" for s in sources):
            errors.append("渠道数量仍待确认，请从需求单创建更正版本核对")
        if key in existing_sources:
            errors.append("已有原始报数来源，不能重复计入；请核对切换期并继续原来源流程")
        if key not in entries:
            errors.append("本期缺少对应报数项目，请先核对模板")
        quantity = sum((s["quantity"] or 0) for s in sources if s["review_status"] != "pending")
        fingerprint = digest(sources)
        adoption = adoptions.get(key)
        rows.append(PrintPreviewRow(category=key[0], sub_category=key[1], quantity=quantity,
            current_quantity=entries.get(key), fingerprint=fingerprint,
            adopted=bool(adoption and adoption.fingerprint == fingerprint and adoption.quantity == quantity), sources=sources, errors=errors))
    token = digest({"issue": issue.issue_number, "status": issue.status.value, "rows": [r.model_dump() for r in rows]})
    return PrintPreviewOut(issue_number=issue.issue_number, token=token, rows=rows,
        can_apply=bool(rows) and issue.status == IssueStatus.draft and not any(r.errors for r in rows))


def apply_print(db: Session, issue_id: int, token: str, user: User) -> PrintPreviewOut:
    issue = db.query(Issue).filter(Issue.id == issue_id).with_for_update().populate_existing().first()
    if issue is None:
        raise HTTPException(404, "刊期不存在")
    db.query(ChannelDemand).join(ChannelDemandLine, ChannelDemandLine.demand_id == ChannelDemand.id).filter(
        ChannelDemandLine.issue_number == issue.issue_number).order_by(ChannelDemand.id).with_for_update().all()
    preview = print_preview(db, issue_id, lock=True)
    if preview.token != token:
        adoptions = {(a.category, a.sub_category): a for a in db.query(ChannelDemandAdoption).filter(
            ChannelDemandAdoption.issue_number == issue.issue_number).with_for_update().populate_existing().all()}
        if preview.rows and all(r.adopted and r.current_quantity == r.quantity and not r.errors
            and adoptions[(r.category, r.sub_category)].apply_token == token for r in preview.rows):
            db.commit()
            return preview
        raise HTTPException(409, "需求、来源或印数已变化，请刷新预览再采用")
    if not preview.can_apply:
        raise HTTPException(409, "刊期已锁定或存在待核对／来源冲突，不能采用")
    for row in preview.rows:
        entry = db.query(ReportEntry).filter(ReportEntry.issue_id == issue_id, ReportEntry.category == row.category, ReportEntry.sub_category == row.sub_category).with_for_update().populate_existing().one()
        adoption = db.query(ChannelDemandAdoption).filter(ChannelDemandAdoption.issue_number == issue.issue_number,
            ChannelDemandAdoption.category == row.category, ChannelDemandAdoption.sub_category == row.sub_category).with_for_update().populate_existing().first()
        if row.adopted and entry.value == row.quantity:
            continue
        if adoption is None:
            adoption = ChannelDemandAdoption(issue_number=issue.issue_number, category=row.category, sub_category=row.sub_category)
            db.add(adoption)
        before = entry.value
        entry.value = row.quantity
        adoption.quantity = row.quantity
        adoption.fingerprint = row.fingerprint
        adoption.apply_token = token
        adoption.source_snapshot = row.sources
        adoption.adopted_by = user.id
        db.flush()
        record_operation(db, user=user, table_name="channel_demand_adoptions", record_id=adoption.id,
            action="adopt_channel_demand", issue_number=issue.issue_number,
            changes={"category": row.category, "sub_category": row.sub_category, "before": before,
                "quantity": row.quantity, "sources": row.sources})
    db.commit()
    invalidate_overview_cache()
    return print_preview(db, issue_id)


def print_confirmation_errors(db: Session, issue: Issue) -> list[dict]:
    db.flush()
    preview = print_preview(db, issue.id, lock=True)
    errors = []
    for row in preview.rows:
        messages = list(row.errors)
        if not row.adopted:
            messages.append("机构需求尚未采用或已变更，请重新预览采用")
        if row.current_quantity != row.quantity:
            messages.append(f"机构需求为{row.quantity}份，与当前印数不一致")
        for message in messages:
            errors.append(dict(field=f"{row.category}/{row.sub_category}", message=message, level="error"))
    return errors


def assert_no_demand_adoption(db: Session, issue_number: int, category: str, sub_category: str) -> None:
    if db.query(ChannelDemandAdoption.id).filter(ChannelDemandAdoption.issue_number == issue_number,
        ChannelDemandAdoption.category == category, ChannelDemandAdoption.sub_category == sub_category).with_for_update().first():
        raise HTTPException(409, "该项目已采用机构／渠道需求，不能再通过原始来源重复计入；请从需求单更正")


def trace_demand(db: Session, demand_id: int) -> list[dict]:
    doc = get_demand(db, demand_id)
    numbers = {l.issue_number for l in doc.lines}
    chain = select(ChannelDemand.id, ChannelDemand.supersedes_id).where(ChannelDemand.id == doc.id).cte(recursive=True)
    chain = chain.union_all(select(ChannelDemand.id, ChannelDemand.supersedes_id).join(chain, ChannelDemand.id == chain.c.supersedes_id))
    ancestor_ids = set(db.execute(select(chain.c.id)).scalars())
    adopted = {(a.issue_number, a.category, a.sub_category): a for a in db.query(ChannelDemandAdoption).filter(ChannelDemandAdoption.issue_number.in_(numbers)).all()}
    issues = {i.issue_number: i for i in db.query(Issue).filter(Issue.issue_number.in_(numbers)).all()}
    result = []
    for line in doc.lines:
        adoption = adopted.get((line.issue_number, doc.category, line.sub_category))
        contribution = next((s for s in adoption.source_snapshot if s["demand_id"] in ancestor_ids), None) if adoption else None
        issue = issues.get(line.issue_number)
        result.append(dict(line_id=line.id, issue_number=line.issue_number, sub_category=line.sub_category,
            issue_id=issue.id if issue else None, print_status=issue.status.value if issue else "not_created",
            adopted_quantity=contribution["quantity"] if contribution else None,
            adopted_version=contribution["version"] if contribution else None,
            adopted_demand_id=contribution["demand_id"] if contribution else None))
    return result
