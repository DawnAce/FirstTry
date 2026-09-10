"""来源交易台账：只读查询与显式业务确认。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import User
from app.models.order_source import OrderSource, OrderSourceLink, OrderSourceVersion
from app.schemas.order_source import SourceListOut, SourceOut
from app.services.order_source_service import source_search_ids

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
    return [{"id": s.id, "platform": s.platform, "store": s.store, "external_order_no": s.external_order_no,
             "kind": s.kind, "revision": s.revision, "order_date": s.order_date,
             "version": s.lock_version,
             "commercial_status": s.commercial_status, "paid_amount": s.paid_amount,
             "verified_refund_amount": s.verified_refund_amount, "verified_refund_date": s.verified_refund_date,
             "finance_note": s.finance_note, "links": links[s.id],
             "snapshot": by_source[s.id][0].snapshot,
             "versions": [{"revision": v.revision, "snapshot": v.snapshot, "created_at": v.created_at}
                          for v in by_source[s.id]] if history else []} for s in sources]


@router.get("", response_model=SourceListOut)
def list_sources(search: str | None = None, pending: bool = False, order_id: int | None = None,
                 skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
                 db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    """在数据库侧筛选来源及历史文本，分页前去重。"""
    query = db.query(OrderSource)
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


@router.get("/{source_id}", response_model=SourceOut)
def get_source(source_id: int, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    source = db.get(OrderSource, source_id)
    if source is None:
        raise HTTPException(404, "来源交易不存在")
    return serialize_sources(db, [source], history=True)[0]
