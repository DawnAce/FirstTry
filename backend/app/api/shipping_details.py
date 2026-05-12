from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models import Issue
from app.models.shipping_detail import ShippingDetail
from app.models.operation_log import OperationLog
from app.models.user import User
from app.auth import get_current_user
from app.schemas.shipping_detail import (
    ShippingDetailCreate, ShippingDetailUpdate, ShippingDetailOut,
)
from app.services.address_service import normalize_address

router = APIRouter(prefix="/api/shipping-details", tags=["shipping-details"])

# Fields to track in operation logs
_TRACKED_FIELDS = [
    "issue_number", "sheet_name", "channel", "sub_channel", "transport", "frequency",
    "status", "name", "address", "phone", "quantity", "deadline",
    "notes", "extra_info", "city", "station_name", "station_hall",
    "contact_person", "seq_number", "period_count", "confirmation",
    "company", "shipped_at",
]

_COPY_FIELDS = [
    field
    for field in _TRACKED_FIELDS
    if field not in {"issue_number", "confirmation", "shipped_at"}
]


def _snapshot(detail: ShippingDetail) -> dict:
    """Return a dict snapshot of tracked fields."""
    result = {}
    for f in _TRACKED_FIELDS:
        val = getattr(detail, f, None)
        # Convert non-serialisable types to string
        if hasattr(val, "isoformat"):
            val = val.isoformat()
        result[f] = val
    return result


def _diff(old: dict, new: dict) -> dict:
    """Return only changed fields as {field: {old, new}}."""
    changes = {}
    for key in old:
        if old[key] != new.get(key):
            changes[key] = {"old": old[key], "new": new.get(key)}
    return changes


def _copy_shipping_details_from_previous(
    db: Session,
    issue_number: int,
    previous_issue_number: int,
    user: User,
) -> tuple[int, bool]:
    db.query(Issue.id).filter(Issue.issue_number == issue_number).with_for_update().first()

    locked_existing_ids = (
        db.query(ShippingDetail.id)
        .filter(ShippingDetail.issue_number == issue_number)
        .with_for_update()
        .all()
    )
    if locked_existing_ids:
        return 0, True

    previous_details = (
        db.query(ShippingDetail)
        .filter(ShippingDetail.issue_number == previous_issue_number)
        .order_by(ShippingDetail.id)
        .all()
    )
    for detail in previous_details:
        data = {field: getattr(detail, field) for field in _COPY_FIELDS}
        db.add(
            ShippingDetail(
                **data,
                issue_number=issue_number,
                confirmation=None,
                shipped_at=None,
            )
        )

    copied = len(previous_details)
    db.add(
        OperationLog(
            table_name="shipping_details",
            record_id=0,
            record_name=f"批量复制到{issue_number}期",
            action="batch_copy",
            changes={
                "from_issue": previous_issue_number,
                "to_issue": issue_number,
                "count": copied,
            },
            user_id=user.id,
            username=user.username,
        )
    )
    return copied, False


@router.get("", response_model=List[ShippingDetailOut])
def list_shipping_details(
    issue_number: Optional[int] = None,
    channel: Optional[str] = None,
    sub_channel: Optional[str] = None,
    transport: Optional[str] = None,
    frequency: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    company: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    query = db.query(ShippingDetail)
    if issue_number is not None:
        query = query.filter(ShippingDetail.issue_number == issue_number)
    if channel:
        query = query.filter(ShippingDetail.channel == channel)
    if sub_channel:
        query = query.filter(ShippingDetail.sub_channel == sub_channel)
    if transport:
        query = query.filter(ShippingDetail.transport == transport)
    if frequency:
        query = query.filter(ShippingDetail.frequency == frequency)
    if status:
        query = query.filter(ShippingDetail.status == status)
    if search:
        query = query.filter(ShippingDetail.name.contains(search))
    if company:
        # Support comma-separated multi-select: "广州日报,成都杂志铺"
        companies = [c.strip() for c in company.split(",") if c.strip()]
        if companies:
            query = query.filter(ShippingDetail.company.in_(companies))
    return query.order_by(ShippingDetail.id).offset(skip).limit(limit).all()


@router.get("/companies", response_model=List[str])
def list_companies(
    issue_number: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Return distinct non-null company values for the dropdown filter."""
    query = db.query(ShippingDetail.company).filter(
        ShippingDetail.company.isnot(None),
        ShippingDetail.company != "",
    ).distinct()
    if issue_number is not None:
        query = query.filter(ShippingDetail.issue_number == issue_number)
    return sorted([row[0] for row in query.all()])


@router.post("/copy-from-previous")
def copy_shipping_details_from_previous(
    issue_number: int = Query(...),
    previous_issue_number: int = Query(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    copied, skipped_existing = _copy_shipping_details_from_previous(
        db=db,
        issue_number=issue_number,
        previous_issue_number=previous_issue_number,
        user=user,
    )
    db.commit()
    if skipped_existing:
        return {"message": "当期已有发货明细，跳过复制", "copied": 0}

    return {
        "message": f"已从{previous_issue_number}期复制{copied}条发货明细",
        "copied": copied,
    }


@router.post("", response_model=ShippingDetailOut, status_code=201)
def create_shipping_detail(
    data: ShippingDetailCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dump = data.model_dump()
    if dump.get("address"):
        parsed = normalize_address(dump["address"])
        dump["address"] = parsed["address"]
        if not dump.get("city") and parsed["city"]:
            dump["city"] = parsed["city"]
    detail = ShippingDetail(**dump)
    db.add(detail)
    db.flush()  # get the id before commit
    log = OperationLog(
        table_name="shipping_details",
        record_id=detail.id,
        record_name=detail.name,
        action="create",
        changes=_snapshot(detail),
        user_id=user.id,
        username=user.username,
    )
    db.add(log)
    db.commit()
    db.refresh(detail)
    return detail


@router.put("/{detail_id}", response_model=ShippingDetailOut)
def update_shipping_detail(
    detail_id: int,
    data: ShippingDetailUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="Shipping detail not found")
    old_snapshot = _snapshot(detail)
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("address"):
        parsed = normalize_address(update_data["address"])
        update_data["address"] = parsed["address"]
        if not update_data.get("city") and parsed["city"]:
            update_data["city"] = parsed["city"]
    for key, value in update_data.items():
        setattr(detail, key, value)
    new_snapshot = _snapshot(detail)
    changes = _diff(old_snapshot, new_snapshot)
    if changes:
        log = OperationLog(
            table_name="shipping_details",
            record_id=detail.id,
            record_name=detail.name,
            action="update",
            changes=changes,
            user_id=user.id,
            username=user.username,
        )
        db.add(log)
    db.commit()
    db.refresh(detail)
    return detail


@router.delete("/{detail_id}")
def delete_shipping_detail(
    detail_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    detail = db.query(ShippingDetail).filter(ShippingDetail.id == detail_id).first()
    if not detail:
        raise HTTPException(status_code=404, detail="Shipping detail not found")
    log = OperationLog(
        table_name="shipping_details",
        record_id=detail.id,
        record_name=detail.name,
        action="delete",
        changes=_snapshot(detail),
        user_id=user.id,
        username=user.username,
    )
    db.add(log)
    db.delete(detail)
    db.commit()
    return {"message": "Deleted"}


@router.post("/normalize-addresses")
def normalize_all_addresses(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batch normalize all shipping detail addresses using cpca."""
    details = db.query(ShippingDetail).filter(
        ShippingDetail.address.isnot(None),
        ShippingDetail.address != "",
    ).all()

    updated = 0
    for detail in details:
        parsed = normalize_address(detail.address)
        changed = False
        if parsed["address"] != detail.address:
            detail.address = parsed["address"]
            changed = True
        if parsed["city"] and not detail.city:
            detail.city = parsed["city"]
            changed = True
        if changed:
            updated += 1

    db.commit()
    return {"message": f"Normalized {updated} addresses out of {len(details)} total"}
