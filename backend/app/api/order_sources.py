"""来源交易台账：只读查询与显式业务确认。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import User
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion, OrderSourceEvent, OrderSourceDeliveryChange
from app.schemas.order_source import SourceListOut, SourceOut, SourceLinkIn, SourceCandidatesOut, SourceLinkPreviewOut
from app.services.order_source_service import source_search_ids
from app.services import order_source_finance_service as finance, order_source_delivery_service as delivery
from app.schemas.order_source import (SourceRefundIn, SourceDeliveryIn, SourceDeliveryUndoIn,
                                     SourceFinanceSummaryOut, SourceDeliveryPreviewOut)
from app.services import order_source_service as service

router = APIRouter(prefix="/api/order-sources", tags=["order-sources"])


def serialize_sources(db: Session, sources: list[OrderSource], history: bool = False) -> list[dict]:
    ids = [s.id for s in sources]
    versions = db.query(OrderSourceVersion).filter(OrderSourceVersion.source_id.in_(ids))
    if not history:
        versions = versions.join(OrderSource, (OrderSource.id == OrderSourceVersion.source_id) &
                                 (OrderSource.revision == OrderSourceVersion.revision))
    by_source: dict[int, list] = {id_: [] for id_ in ids}
    for v in versions.order_by(OrderSourceVersion.revision.desc()).all():
        by_source[v.source_id].append(v)
    links: dict[int, list] = {id_: [] for id_ in ids}
    for link in db.query(OrderSourceLink).filter(OrderSourceLink.source_id.in_(ids)).all():
        links[link.source_id].append(link)
    events: dict[int, list] = {id_: [] for id_ in ids}
    changes: dict[int, list] = {id_: [] for id_ in ids}
    if history:
        for event in db.query(OrderSourceEvent).filter(OrderSourceEvent.source_id.in_(ids)).order_by(OrderSourceEvent.id.desc()):
            events[event.source_id].append({"id": event.id, "action": event.action, "payload": event.payload,
                                            "operator_id": event.operator_id, "created_at": event.created_at})
        for change in db.query(OrderSourceDeliveryChange).filter(OrderSourceDeliveryChange.source_id.in_(ids)).order_by(OrderSourceDeliveryChange.id.desc()):
            changes[change.source_id].append({"id": change.id, "link_id": change.link_id,
                "from_target_id": change.from_target_id, "to_target_id": change.to_target_id,
                "effective_from_issue": change.effective_from_issue, "effective_date": change.effective_date,
                "status": change.status, "reason": change.reason})
    return [{"id": s.id, "platform": s.platform, "store": s.store, "external_order_no": s.external_order_no,
             "kind": s.kind, "revision": s.revision, "order_date": s.order_date,
             "version": s.lock_version,
             "commercial_status": s.commercial_status, "paid_amount": s.paid_amount,
             "verified_refund_amount": s.verified_refund_amount, "verified_refund_date": s.verified_refund_date,
             "finance_note": s.finance_note, "links": links[s.id],
             **finance.finance_state(s, links[s.id]), "events": events[s.id], "delivery_changes": changes[s.id],
             "snapshot": by_source[s.id][0].snapshot,
             "versions": [{"revision": v.revision, "snapshot": v.snapshot, "created_at": v.created_at}
                          for v in by_source[s.id]] if history else []} for s in sources]


@router.get("", response_model=SourceListOut)
def list_sources(search: str | None = None, pending: bool = False, order_id: int | None = None, kind: str | None = None,
                 skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
                 db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """在数据库侧筛选来源及历史文本，分页前去重。"""
    query = db.query(OrderSource)
    if kind:
        query = query.filter(OrderSource.kind == kind)
    if search and search.strip():
        query = query.filter(OrderSource.id.in_(source_search_ids(search)))
    linked = select(OrderSourceLink.source_id).where(OrderSourceLink.active == 1)
    if pending:
        query = query.filter(~OrderSource.id.in_(linked))
    if order_id is not None:
        query = query.filter(OrderSource.id.in_(linked.where(OrderSourceLink.order_id == order_id)))
    total = query.count()
    rows = query.order_by(OrderSource.id.desc()).offset(skip).limit(limit).all()
    return {"total": total, "rows": serialize_sources(db, rows)}


@router.get("/financial-summary", response_model=SourceFinanceSummaryOut)
def financial_summary(order_id: int | None = None, db: Session = Depends(get_db),
                      _user: User = Depends(get_current_user)):
    """独立运费按交易唯一计数；主单汇总只计分配额，来源订阅不重复加款。"""
    return finance.finance_summary(db, order_id)


@router.get("/{source_id}", response_model=SourceOut)
def get_source(source_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    source = db.get(OrderSource, source_id)
    if source is None:
        raise HTTPException(404, "来源交易不存在")
    return serialize_sources(db, [source], history=True)[0]


@router.get("/{source_id}/candidates", response_model=SourceCandidatesOut)
def candidates(source_id: int, search: str | None = None, db: Session = Depends(get_db),
               _user: User = Depends(get_current_user)):
    """按收件资料和订期推荐，最多100个候选；不会自动关联。"""
    return service.candidates(db, source_id, search)


@router.post("/{source_id}/link-preview", response_model=SourceLinkPreviewOut)
def preview_links(source_id: int, body: SourceLinkIn, db: Session = Depends(get_db),
                  _user: User = Depends(require_admin)):
    """核对分配金额和订阅版本，不写入。"""
    source = service.get_source(db, source_id, body.version)
    return service.validate_links(db, source, body)


@router.put("/{source_id}/links", response_model=SourceOut)
def link_source(source_id: int, body: SourceLinkIn, db: Session = Depends(get_db),
                user: User = Depends(require_admin)):
    """原子更新归属，旧关联及操作原因保留。"""
    try:
        source = service.link_source(db, source_id, body, user.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return serialize_sources(db, [source], history=True)[0]


@router.post("/{source_id}/refund-preview", response_model=SourceOut)
def refund_preview(source_id: int, body: SourceRefundIn, db: Session = Depends(get_db),
                   _user: User = Depends(require_admin)):
    """核对累计退款及目标分配，不写入退款流水。"""
    return serialize_sources(db, [finance.verify_refund(db, source_id, body, None)], history=True)[0]


@router.put("/{source_id}/refund", response_model=SourceOut)
def verify_refund(source_id: int, body: SourceRefundIn, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    """按凭据确认来源累计退款；重复请求不累加，不改变主单状态。"""
    try:
        source = finance.verify_refund(db, source_id, body, user.id, apply=True)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return serialize_sources(db, [source], history=True)[0]


@router.get("/{source_id}/delivery-options")
def delivery_options(source_id: int, link_id: int, db: Session = Depends(get_db),
                     _user: User = Depends(get_current_user)):
    """读取订期内的正式未来刊期和当前目标。"""
    return delivery.options(db, source_id, link_id)


@router.post("/{source_id}/delivery-preview", response_model=SourceDeliveryPreviewOut)
def delivery_preview(source_id: int, body: SourceDeliveryIn, db: Session = Depends(get_db),
                     _user: User = Depends(require_admin)):
    """核对目标版本、刊期、邮局记录和发货冲突。"""
    return delivery.preview(db, source_id, body)


@router.post("/{source_id}/delivery", response_model=SourceOut)
def apply_delivery(source_id: int, body: SourceDeliveryIn, db: Session = Depends(get_db),
                   user: User = Depends(require_admin)):
    """确认邮局手续后原子追加转投目标，保留历史，不自动发货。"""
    try:
        source = delivery.apply(db, source_id, body, user.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return serialize_sources(db, [source], history=True)[0]


@router.post("/{source_id}/delivery-undo-preview")
def delivery_undo_preview(source_id: int, body: SourceDeliveryUndoIn, db: Session = Depends(get_db),
                          _user: User = Depends(require_admin)):
    """预览撤回尚未执行的安排；已执行历史只能向后更正。"""
    return delivery.undo(db, source_id, body, None)


@router.post("/{source_id}/delivery-undo", response_model=SourceOut)
def undo_delivery(source_id: int, body: SourceDeliveryUndoIn, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    """撤回未来、无发货且未被后续编辑的转投，旧历史继续保留。"""
    try:
        delivery.undo(db, source_id, body, user.id, apply=True)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return serialize_sources(db, [service.get_source(db, source_id)], history=True)[0]
