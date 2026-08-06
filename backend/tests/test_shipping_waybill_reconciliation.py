from datetime import date
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    ShippingDetail,
    ShippingWaybillImportBatch,
)
from app.models.user import User, UserRole
from app.schemas.shipping_detail import ShippingDetailOut
from app.schemas.shipping_waybill import WaybillImportBatchOut
from app.services.shipping_waybill_service import (
    confirm_import,
    fulfillment_summary,
    parse_waybill_workbook,
    preview_import,
)


def _workbook_bytes() -> bytes:
    wb = Workbook()
    main = wb.active
    main.title = "中通+顺丰到付"
    main.append([None, None, None, None, "电话", "地址", "姓名", "份数"])
    main.append(["经营报", None, "73592817527861", None, "13800000000", "北京市测试路1号", "张三", 1])
    main.append(["经营报", None, "73592817528444", None, "13800000000", "北京市测试路1号", "张三", 2])

    internal = wb.create_sheet("299（备用74+社用225）")
    internal.append(["姓名", "地址", "电话", "份数", "刊物", "备注"])
    internal.append(["库房", "中通库房", "13900000000", 2, "中国经营报", "备用报"])
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _supplement_workbook_bytes(detail_id: int) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "运单补录"
    ws.append(["发货明细ID", "快递公司", "运单号", "实发份数", "姓名", "电话", "地址"])
    ws.append([detail_id, "中通", "73592817529999", 1, "待补客户", "13700000000", "北京市测试路2号"])
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_parser_recognizes_packages_and_no_tracking_rows():
    rows = parse_waybill_workbook(_workbook_bytes())
    assert len(rows) == 3
    assert sum(row.quantity for row in rows) == 5
    assert sum(bool(row.tracking_no) for row in rows) == 2
    assert sum(row.no_tracking_required for row in rows) == 1


def test_preview_confirm_keeps_one_copy_pending_and_supports_multiple_packages():
    db = _db()
    user = User(username="tester", password_hash="x", role=UserRole.admin)
    issue = Issue(issue_number=2638, publish_date=date(2026, 1, 26), status=IssueStatus.confirmed)
    db.add_all([user, issue])
    db.flush()
    db.add(IssueAuditSnapshot(
        issue_id=issue.id,
        snapshot_type="confirm",
        report_total=6,
        shipping_total=6,
        delta=0,
        is_match=True,
    ))
    recipient = ShippingDetail(
        issue_number=2638,
        sheet_name="每周",
        channel="个人订阅",
        transport="中通物流",
        frequency="周",
        status="正常",
        name="张三",
        phone="13800000000",
        address="北京市测试路1号",
        quantity=3,
    )
    internal = ShippingDetail(
        issue_number=2638,
        sheet_name="留存",
        channel="库房留存",
        transport="库房留存",
        frequency="周",
        status="正常",
        name="库房",
        phone="13900000000",
        address="中通库房",
        quantity=2,
    )
    missing = ShippingDetail(
        issue_number=2638,
        sheet_name="每周",
        channel="个人订阅",
        transport="中通物流",
        frequency="周",
        status="正常",
        name="待补客户",
        phone="13700000000",
        address="北京市测试路2号",
        quantity=1,
    )
    db.add_all([recipient, internal, missing])
    db.commit()

    content = _workbook_bytes()
    preview = preview_import(db, issue.id, "单号.xlsx", content, user)
    assert preview.expected_quantity == 6
    assert preview.parsed_quantity == 5
    assert preview.matched_quantity == 5
    assert preview.pending_quantity == 1
    assert preview.matched_rows == 3
    assert preview.unmatched_rows == 0
    assert len(WaybillImportBatchOut.model_validate(preview).rows) == 3

    same_preview = preview_import(db, issue.id, "重命名.xlsx", content, user)
    assert same_preview.id == preview.id
    assert db.query(ShippingWaybillImportBatch).count() == 1

    confirmed = confirm_import(db, preview.id, user)
    assert confirmed.status == "confirmed"
    summary = fulfillment_summary(db, issue.id)
    assert summary.expected_quantity == 6
    assert summary.handled_quantity == 5
    assert summary.tracked_quantity == 3
    assert summary.no_tracking_quantity == 2
    assert summary.pending_quantity == 1
    assert summary.package_count == 2
    assert summary.status == "partial"

    db.refresh(recipient)
    db.refresh(internal)
    assert recipient.package_count == 2
    assert recipient.handled_quantity == 3
    assert recipient.fulfillment_status == "shipped"
    assert ShippingDetailOut.model_validate(recipient).package_count == 2
    assert internal.fulfillment_status == "no_tracking_required"
    assert missing.fulfillment_status == "pending"

    supplement = preview_import(db, issue.id, "补单.xlsx", _supplement_workbook_bytes(missing.id), user)
    assert supplement.matched_quantity == 1
    assert supplement.pending_quantity == 0
    confirm_import(db, supplement.id, user)
    completed = fulfillment_summary(db, issue.id)
    assert completed.handled_quantity == 6
    assert completed.pending_quantity == 0
    assert completed.status == "shipped"
