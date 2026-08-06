from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import ShippingDetail, ShippingPackage
from app.models.user import User
from app.schemas.shipping_detail import ShippingPackageOut
from app.schemas.shipping_waybill import (
    FulfillmentSummaryOut,
    ManualPackageIn,
    NoTrackingRequirementIn,
    WaybillImportBatchOut,
)
from app.services.operation_log_service import record_operation
from app.services.shipping_waybill_service import (
    confirm_import,
    fulfillment_summary,
    preview_import,
    refresh_detail_shipping_fields,
)
from app.upload import read_upload


router = APIRouter(prefix="/api/shipping-waybills", tags=["shipping-waybills"])


@router.post("/issues/{issue_id}/preview", response_model=WaybillImportBatchOut)
async def preview_waybill_import(
    issue_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    content = await read_upload(file, label="运单文件")
    return preview_import(db, issue_id, file.filename or "运单导入.xlsx", content, user)


@router.post("/imports/{batch_id}/confirm", response_model=WaybillImportBatchOut)
def confirm_waybill_import(
    batch_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return confirm_import(db, batch_id, user)


@router.get("/issues/{issue_id}/summary", response_model=FulfillmentSummaryOut)
def get_fulfillment_summary(issue_id: int, db: Session = Depends(get_db)):
    return fulfillment_summary(db, issue_id)


@router.post("/details/{detail_id}/packages", response_model=ShippingPackageOut)
def add_manual_package(
    detail_id: int,
    body: ManualPackageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="发货明细不存在")
    tracking_no = body.tracking_no.strip().upper()
    duplicate = db.query(ShippingPackage.id).filter(
        ShippingPackage.carrier == body.carrier.strip(),
        ShippingPackage.tracking_no == tracking_no,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="该运单号已存在")
    package = ShippingPackage(
        shipping_detail=detail,
        carrier=body.carrier.strip(),
        tracking_no=tracking_no,
        quantity=body.quantity,
        shipped_at=body.shipped_at or datetime.now(),
    )
    detail.shipping_requirement = "tracking_required"
    db.add(package)
    db.flush()
    refresh_detail_shipping_fields(detail)
    record_operation(
        db,
        user=user,
        table_name="shipping_details",
        record_id=detail.id,
        record_name=detail.name,
        action="add_package",
        issue_number=detail.issue_number,
        channel=detail.channel,
        changes={"carrier": package.carrier, "tracking_no": tracking_no, "quantity": package.quantity},
    )
    db.commit()
    db.refresh(package)
    return package


@router.delete("/packages/{package_id}", status_code=204)
def delete_package(
    package_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    package = db.query(ShippingPackage).filter(ShippingPackage.id == package_id).first()
    if not package:
        raise HTTPException(status_code=404, detail="运单不存在")
    detail = package.shipping_detail
    changes = {"carrier": package.carrier, "tracking_no": package.tracking_no, "quantity": package.quantity}
    detail.packages.remove(package)
    db.delete(package)
    db.flush()
    if detail.packages:
        refresh_detail_shipping_fields(detail)
    else:
        detail.shipped_at = None
        detail.shipped_quantity = None
        detail.tracking_no = None
    record_operation(
        db,
        user=user,
        table_name="shipping_details",
        record_id=detail.id,
        record_name=detail.name,
        action="delete_package",
        issue_number=detail.issue_number,
        channel=detail.channel,
        changes=changes,
    )
    db.commit()


@router.post("/details/{detail_id}/no-tracking", response_model=FulfillmentSummaryOut)
def set_no_tracking_requirement(
    detail_id: int,
    body: NoTrackingRequirementIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="发货明细不存在")
    if body.no_tracking_required and detail.packages:
        raise HTTPException(status_code=409, detail="该明细已有运单，请先删除运单")
    old = detail.shipping_requirement
    detail.shipping_requirement = "no_tracking_required" if body.no_tracking_required else "tracking_required"
    if body.no_tracking_required:
        detail.shipped_at = None
        detail.shipped_quantity = None
        detail.tracking_no = None
    record_operation(
        db,
        user=user,
        table_name="shipping_details",
        record_id=detail.id,
        record_name=detail.name,
        action="set_shipping_requirement",
        issue_number=detail.issue_number,
        channel=detail.channel,
        changes={"old": old, "new": detail.shipping_requirement},
    )
    db.commit()
    issue_id = detail.issue_number
    # fulfillment_summary 接收刊期主键，按期号反查主键。
    from app.models import Issue
    issue = db.query(Issue).filter(Issue.issue_number == issue_id).first()
    return fulfillment_summary(db, issue.id)
