"""机构订货／渠道报数：草稿、凭证预览、人工确认及印数采用。"""
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth import get_current_user, require_mutation_permission
from app.database import get_db
from app.models import ChannelDemand, ChannelDemandAttachment, User
from app.schemas.channel_demand import AnnualPricingOut, DemandOptionsOut, DemandTraceOut, DemandIn, DemandListOut, DemandOut, DemandVersionIn, PrintApplyIn, PrintPreviewOut
from app.services import attachment_service
from app.services import channel_demand_service as service
from app.services.operation_log_service import record_operation
from app.services.report_source_ocr import recognize_report_source
from app.upload import read_upload

router = APIRouter(prefix='/api/channel-demands', tags=['channel-demands'], dependencies=[Depends(require_mutation_permission)])


@router.get('/options', response_model=DemandOptionsOut)
def options(db: Session = Depends(get_db)):
    """已有机构ID及渠道默认值；合同可选，不作为生效门槛。"""
    return service.options(db)


@router.get('/pricing/{year}', response_model=AnnualPricingOut)
def pricing(year: int, db: Session = Depends(get_db)):
    return service.annual_pricing(db, year)


@router.get('/print/{issue_id}', response_model=PrintPreviewOut)
def print_preview(issue_id: int, db: Session = Depends(get_db)):
    """展示需求与印数差异；采用将替换对应分项。"""
    return service.print_preview(db, issue_id)


@router.post('/print/{issue_id}/apply', response_model=PrintPreviewOut)
def apply_print(issue_id: int, body: PrintApplyIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """重新校验预览、锁定和来源冲突；原子替换，重复采用不累加。"""
    return service.apply_print(db, issue_id, body.token, user)


@router.get('', response_model=DemandListOut)
def list_demands(partner_id: int | None = None, status: str | None = None, document_type: str | None = None,
                 received_start: date | None = None, received_end: date | None = None,
                 skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    """数据库筛选分页；待定明细保留在单据中。"""
    query = db.query(ChannelDemand)
    for field, value in [('partner_id', partner_id), ('status', status), ('document_type', document_type)]:
        if value is not None:
            query = query.filter(getattr(ChannelDemand, field) == value)
    if received_start:
        query = query.filter(ChannelDemand.received_date >= received_start)
    if received_end:
        query = query.filter(ChannelDemand.received_date <= received_end)
    total = query.count()
    rows = query.options(joinedload(ChannelDemand.partner), selectinload(ChannelDemand.lines), selectinload(ChannelDemand.attachments)).order_by(ChannelDemand.id.desc()).offset(skip).limit(limit).all()
    return DemandListOut(total=total, items=[service.output(doc) for doc in rows])


@router.post('', response_model=DemandOut, status_code=201)
def create(body: DemandIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.output(service.save_demand(db, body, user))


@router.get('/{demand_id}', response_model=DemandOut)
def detail(demand_id: int, db: Session = Depends(get_db)):
    return service.output(service.get_demand(db, demand_id))


@router.put('/{demand_id}', response_model=DemandOut)
def update(demand_id: int, body: DemandIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.output(service.save_demand(db, body, user, demand_id))


@router.post('/{demand_id}/confirm', response_model=DemandOut)
def confirm(demand_id: int, body: DemandVersionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """人工核对当前版本；已核对部分生效，待定项持续阻断印数采用。"""
    return service.output(service.confirm_demand(db, demand_id, body.version, body.reviewed, user))


@router.post('/{demand_id}/revise', response_model=DemandOut, status_code=201)
def revise(demand_id: int, body: DemandVersionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.output(service.revise_demand(db, demand_id, body.version, user))


@router.get('/{demand_id}/trace', response_model=list[DemandTraceOut])
def trace(demand_id: int, db: Session = Depends(get_db)):
    return service.trace_demand(db, demand_id)


@router.post('/{demand_id}/attachments', response_model=DemandOut, status_code=201)
async def upload_attachment(demand_id: int, version: int = Form(...), file: UploadFile = File(...),
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    filename = Path(file.filename or 'source').name
    if Path(filename).suffix.lower() not in {'.pdf', '.png', '.jpg', '.jpeg'}:
        raise HTTPException(422, '仅支持PDF、PNG、JPG、JPEG凭证')
    content = await read_upload(file, label='需求凭证')
    doc = service.get_demand(db, demand_id, lock=True)
    if doc.status != 'draft' or doc.version != version:
        raise HTTPException(409, '需求版本已变化或已确认，请刷新')
    digest = attachment_service.sha256_hex(content)
    if any(a.sha256 == digest for a in doc.attachments):
        return service.output(doc)
    if doc.category in {'postal', 'retail', 'guangzhou', 'chengdu'}:
        extraction = recognize_report_source(channel=doc.category, filename=filename, content=content, year_hint=doc.received_date.year)
        if extraction.get('source_date'):
            extraction['source_date'] = str(extraction['source_date'])
    else:
        extraction = {'warnings': ['此渠道暂无识别模板，请对照原件人工录入'], 'suggestions': []}
    stored_path = attachment_service.store_file('channel_demands', filename, content)
    try:
        doc.attachments.append(ChannelDemandAttachment(filename=filename[:255], stored_path=stored_path, sha256=digest, extraction=extraction))
        doc.version += 1
        record_operation(db, user=user, table_name='channel_demands', record_id=doc.id,
                         action='upload_demand_attachment', changes={'version': doc.version})
        db.commit()
    except Exception:
        db.rollback()
        attachment_service.delete_file(stored_path)
        raise
    return service.output(service.get_demand(db, demand_id))


@router.get('/{demand_id}/attachments/{attachment_id}/download')
def download(demand_id: int, attachment_id: int, db: Session = Depends(get_db)):
    doc = service.get_demand(db, demand_id)
    attachment = next((a for a in doc.attachments if a.id == attachment_id), None)
    if attachment is None:
        raise HTTPException(404, '凭证不存在')
    try:
        path = attachment_service.resolve_path(attachment.stored_path)
    except ValueError as exc:
        raise HTTPException(404, '凭证路径无效') from exc
    if not path.is_file():
        raise HTTPException(404, '凭证文件缺失')
    return FileResponse(path, filename=attachment.filename)
