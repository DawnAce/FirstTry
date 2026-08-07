from datetime import date
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.api.reports import get_report
from app.models import (
    Issue,
    IssueAuditSnapshot,
    IssueStatus,
    ShippingDetail,
    ShippingFulfillmentAdjustment,
    ShippingWaybillImportBatch,
    ShippingWaybillImportRow,
)
from app.models.user import User, UserRole
from app.schemas.shipping_detail import ShippingDetailOut
from app.schemas.shipping_waybill import (
    FulfillmentAdjustmentAttributionIn,
    FulfillmentAdjustmentIn,
    WaybillBulkMatchIn,
    WaybillImportBatchOut,
    WaybillImportRowCreate,
    WaybillImportRowUpdate,
)
from app.services.shipping_waybill_service import (
    add_import_row,
    attribute_fulfillment_adjustment,
    bulk_match_import_rows,
    confirm_import,
    create_fulfillment_adjustment,
    fulfillment_summary,
    get_draft_import,
    parse_waybill_workbook,
    preview_import,
    update_import_row,
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


def _supplement_workbook_bytes(detail_id: int, tracking_no: str = "73592817529999") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "运单补录"
    ws.append(["发货明细ID", "快递公司", "运单号", "实发份数", "姓名", "电话", "地址"])
    ws.append([detail_id, "中通", tracking_no, 1, "待补客户", "13700000000", "北京市测试路2号"])
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _unrecognized_workbook_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "临时格式"
    ws.append(["说明", "内容"])
    ws.append(["王五", "此行未按已知列布局排列", 3])
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _high_speed_rail_workbook_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "巴出高铁110"
    ws.append(["刊物", "打印名称", "单号", "打印名称", "电话", "地址", "展示名称", "姓名", "份数"])
    ws.append([
        "中国经营报5-18日",
        "赵叶5",
        "73708644153509",
        "赵叶5",
        "15810698235",
        "北京市东城区北京站广场西侧商务专用通道 赵叶 15810698235",
        "商务座候车区（北京站）",
        "赵叶",
        5,
        "☑",
        "北京站",
    ])
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _split_chengdu_packages_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "中通+顺丰到付970"
    ws.append([None, None, None, None, "电话", "地址", "姓名", "份数"])
    for tracking_no, quantity in [
        ("73592817556132", 65),
        ("73592817560608", 100),
        ("73592817561275", 100),
        ("73592817561872", 100),
    ]:
        ws.append([
            "经营报1-26日", None, tracking_no, None, "15719468023",
            "成都市双流文星镇通关路86号A1－A4杂志铺/\n028－85312807",
            "肖波", quantity,
        ])
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


def test_parser_retains_unrecognized_candidate_with_raw_cells():
    rows = parse_waybill_workbook(_unrecognized_workbook_bytes())
    assert len(rows) == 1
    assert rows[0].parse_reason == "未能按当前工作表格式识别，请人工补充"
    assert rows[0].raw_values == ["王五", "此行未按已知列布局排列", "3"]


def test_parser_recognizes_high_speed_rail_sheet_columns():
    rows = parse_waybill_workbook(_high_speed_rail_workbook_bytes())
    assert len(rows) == 1
    assert rows[0].source_sheet == "巴出高铁110"
    assert rows[0].tracking_no == "73708644153509"
    assert rows[0].carrier == "中通"
    assert rows[0].recipient_name == "赵叶"
    assert rows[0].phone == "15810698235"
    assert rows[0].address == "北京市东城区北京站广场西侧商务专用通道 赵叶 15810698235"
    assert rows[0].quantity == 5
    assert rows[0].parse_reason is None


def test_parser_does_not_retain_total_row_as_unrecognized_data():
    wb = Workbook()
    ws = wb.active
    ws.title = "299（备用74+社用225）"
    ws.append(["姓名", "地址", "电话", "份数"])
    ws.append(["库房", "中通库房", "13900000000", 299])
    ws.append([None, None, "合计", 299])
    out = BytesIO()
    wb.save(out)
    rows = parse_waybill_workbook(out.getvalue())
    assert len(rows) == 1
    assert rows[0].quantity == 299


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

    first_row = preview.rows[0]
    edited = update_import_row(
        db,
        preview.id,
        first_row.id,
        WaybillImportRowUpdate(recipient_name="人工确认张三", shipping_detail_id=recipient.id),
    )
    assert edited.rows[0].manual_reviewed is True
    assert edited.rows[0].recipient_name == "人工确认张三"
    assert edited.matched_quantity == 5

    same_preview = preview_import(db, issue.id, "重命名.xlsx", content, user)
    assert same_preview.id == preview.id
    assert same_preview.rows[0].recipient_name == "人工确认张三"
    assert get_draft_import(db, issue.id).id == preview.id
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


def test_manual_review_ignore_add_and_duplicate_recalculation():
    db = _db()
    user = User(username="reviewer", password_hash="x", role=UserRole.admin)
    issue = Issue(issue_number=3001, publish_date=date(2026, 2, 2), status=IssueStatus.confirmed)
    db.add_all([user, issue])
    db.flush()
    db.add(IssueAuditSnapshot(
        issue_id=issue.id,
        snapshot_type="confirm",
        report_total=2,
        shipping_total=2,
        delta=0,
        is_match=True,
    ))
    first = ShippingDetail(
        issue_number=3001, sheet_name="每周", channel="个人订阅", transport="中通物流",
        frequency="周", status="正常", name="待补客户", phone="13700000000",
        address="北京市测试路2号", quantity=1,
    )
    second = ShippingDetail(
        issue_number=3001, sheet_name="每周", channel="个人订阅", transport="中通物流",
        frequency="周", status="正常", name="人工客户", phone="13600000000",
        address="北京市测试路3号", quantity=1,
    )
    db.add_all([first, second])
    db.commit()

    batch = preview_import(db, issue.id, "待核对.xlsx", _supplement_workbook_bytes(first.id), user)
    row = batch.rows[0]
    ignored = update_import_row(
        db, batch.id, row.id, WaybillImportRowUpdate(ignored=True, ignore_reason="测试忽略")
    )
    assert ignored.rows[0].match_status == "ignored"
    assert ignored.rows[0].match_reason == "已人工忽略：测试忽略"
    assert ignored.unmatched_rows == 0
    assert ignored.matched_quantity == 0

    restored = update_import_row(
        db, batch.id, row.id, WaybillImportRowUpdate(ignored=False, shipping_detail_id=first.id)
    )
    assert restored.rows[0].match_status == "matched"
    assert restored.matched_quantity == 1

    with_duplicate = add_import_row(db, batch.id, WaybillImportRowCreate(
        carrier="中通", tracking_no="73592817529999", quantity=1,
        recipient_name="人工客户", phone="13600000000", address="北京市测试路3号",
        shipping_detail_id=second.id,
    ))
    duplicate = db.query(ShippingWaybillImportRow).filter(
        ShippingWaybillImportRow.batch_id == batch.id,
        ShippingWaybillImportRow.source_sheet == "人工补充",
    ).one()
    assert duplicate.match_status == "duplicate"
    assert with_duplicate.unmatched_rows == 1
    assert with_duplicate.matched_quantity == 1

    fixed = update_import_row(
        db,
        batch.id,
        duplicate.id,
        WaybillImportRowUpdate(tracking_no="73592817530000", shipping_detail_id=second.id),
    )
    assert fixed.matched_quantity == 2
    assert fixed.pending_quantity == 0

    confirm_import(db, batch.id, user)
    try:
        update_import_row(db, batch.id, duplicate.id, WaybillImportRowUpdate(quantity=2))
        assert False, "confirmed batches must be immutable"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409


def test_confirmed_unmatched_split_packages_can_be_bulk_linked_then_close_file_gap():
    db = _db()
    user = User(username="operator", password_hash="x", role=UserRole.admin)
    issue = Issue(issue_number=2638, publish_date=date(2026, 1, 26), status=IssueStatus.confirmed)
    db.add_all([user, issue])
    db.flush()
    db.add(IssueAuditSnapshot(
        issue_id=issue.id,
        snapshot_type="confirm",
        report_total=1321,
        shipping_total=1321,
        delta=0,
        is_match=True,
    ))
    detail = ShippingDetail(
        issue_number=2638,
        sheet_name="每周",
        channel="成都杂志铺",
        transport="中通物流",
        frequency="周",
        status="正常",
        name="肖波",
        phone="15719468023/\n028－85312807",
        address="成都市双流文星镇通关路86号A1－A4杂志铺",
        quantity=365,
    )
    base_detail = ShippingDetail(
        issue_number=2638,
        sheet_name="确认版",
        channel="其他发货",
        transport="中通物流",
        frequency="周",
        status="正常",
        name="已核销基础明细",
        quantity=955,
        shipping_requirement="no_tracking_required",
    )
    db.add_all([detail, base_detail])
    db.commit()

    batch = preview_import(db, issue.id, "单号-经营报1-26日.xlsx", _split_chengdu_packages_bytes(), user)
    assert batch.parsed_quantity == 365
    assert batch.matched_quantity == 0
    assert batch.unmatched_rows == 4
    assert sum(row.quantity for row in batch.rows) == 365

    confirmed = confirm_import(db, batch.id, user)
    assert confirmed.status == "confirmed"
    assert confirmed.pending_quantity == 366
    assert get_draft_import(db, issue.id).id == confirmed.id

    linked = bulk_match_import_rows(
        db,
        confirmed.id,
        WaybillBulkMatchIn(row_ids=[row.id for row in confirmed.rows], shipping_detail_id=detail.id),
        user,
    )
    assert linked.matched_rows == 4
    assert linked.matched_quantity == 365
    assert linked.unmatched_rows == 0
    assert linked.pending_quantity == 1

    db.refresh(detail)
    assert detail.package_count == 4
    assert detail.handled_quantity == 365
    assert {package.quantity for package in detail.packages} == {65, 100}

    completed = create_fulfillment_adjustment(
        db,
        issue.id,
        FulfillmentAdjustmentIn(
            quantity=1,
            reason="每月两次合寄 · 暂停寄送",
            shipping_detail_id=detail.id,
        ),
        user,
    )
    assert completed.expected_quantity == 1321
    assert completed.planned_quantity == 1320
    assert completed.tracked_quantity == 365
    assert completed.no_tracking_quantity == 955
    assert completed.adjustment_quantity == 1
    assert completed.attributed_adjustment_quantity == 1
    assert completed.unattributed_adjustment_quantity == 0
    assert completed.actual_shipped_quantity == 1320
    assert completed.handled_quantity == 1321
    assert completed.pending_quantity == 0
    assert completed.status == "shipped"
    assert completed.shipment_status == "partial"

    report = get_report(issue.id, db=db)
    assert report.confirmation_summary.confirmed_shipping_total == 1321
    assert report.confirmation_summary.current_shipping_total == 1320
    assert report.confirmation_summary.plan_attributed_quantity == 1
    assert report.confirmation_summary.plan_unexplained_delta == 0
    assert report.confirmation_summary.plan_is_reconciled is True

    try:
        create_fulfillment_adjustment(
            db,
            issue.id,
            FulfillmentAdjustmentIn(quantity=1, reason=" ", shipping_detail_id=detail.id),
            user,
        )
        assert False, "blank adjustment reasons must be rejected"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400


def test_historical_unassigned_adjustment_can_be_attributed_without_changing_physical_shipment():
    db = _db()
    user = User(username="historian", password_hash="x", role=UserRole.admin)
    issue = Issue(issue_number=4001, publish_date=date(2026, 1, 26), status=IssueStatus.confirmed)
    detail = ShippingDetail(
        issue_number=4001,
        sheet_name="确认版",
        channel="个人订阅",
        transport="中通物流",
        frequency="半月",
        status="停发",
        name="暂停寄送客户",
        quantity=1,
        shipping_requirement="no_tracking_required",
    )
    db.add_all([user, issue, detail])
    db.flush()
    db.add(IssueAuditSnapshot(
        issue_id=issue.id,
        snapshot_type="confirm",
        report_total=2,
        shipping_total=2,
        delta=0,
        is_match=True,
    ))
    legacy = ShippingFulfillmentAdjustment(
        issue_id=issue.id,
        issue_number=issue.issue_number,
        quantity=1,
        reason="每月两次合寄 · 暂停寄送",
        created_by=user.id,
    )
    db.add(legacy)
    db.commit()

    before = fulfillment_summary(db, issue.id)
    before_report = get_report(issue.id, db=db)
    assert before_report.confirmation_summary.plan_is_reconciled is False
    assert before_report.confirmation_summary.unattributed_adjustment_quantity == 1
    assert before.actual_shipped_quantity == 1
    assert before.adjustment_quantity == 1
    assert before.unattributed_adjustment_quantity == 1
    assert before.pending_quantity == 0
    assert before.status == "shipped"
    assert before.shipment_status == "partial"
    assert before.adjustments[0].is_attributed is False

    after = attribute_fulfillment_adjustment(
        db,
        legacy.id,
        FulfillmentAdjustmentAttributionIn(shipping_detail_id=detail.id),
        user,
    )
    assert after.attributed_adjustment_quantity == 1
    assert after.unattributed_adjustment_quantity == 0
    assert after.actual_shipped_quantity == 1
    assert after.pending_quantity == 0
    assert after.adjustments[0].detail_name_snapshot == "暂停寄送客户"

    after_report = get_report(issue.id, db=db)
    assert after_report.confirmation_summary.plan_attributed_quantity == 1
    assert after_report.confirmation_summary.plan_unexplained_delta == 0
    assert after_report.confirmation_summary.plan_is_reconciled is True
    assert after_report.confirmation_summary.unattributed_adjustment_quantity == 0

    db.refresh(detail)
    assert detail.fulfillment_status == "no_tracking_required"
    assert detail.handled_quantity == 1


def test_explicit_reparse_replaces_the_active_draft():
    db = _db()
    user = User(username="reparser", password_hash="x", role=UserRole.admin)
    issue = Issue(issue_number=3002, publish_date=date(2026, 2, 9), status=IssueStatus.confirmed)
    detail = ShippingDetail(
        issue_number=3002, sheet_name="每周", channel="个人订阅", transport="中通物流",
        frequency="周", status="正常", name="待补客户", phone="13700000000",
        address="北京市测试路2号", quantity=1,
    )
    db.add_all([user, issue, detail])
    db.commit()

    original = preview_import(db, issue.id, "旧草稿.xlsx", _supplement_workbook_bytes(detail.id), user)
    update_import_row(
        db, original.id, original.rows[0].id,
        WaybillImportRowUpdate(recipient_name="旧的人工修正", shipping_detail_id=detail.id),
    )
    replacement = preview_import(
        db,
        issue.id,
        "新草稿.xlsx",
        _supplement_workbook_bytes(detail.id, "73592817531111"),
        user,
        reparse=True,
    )
    assert db.query(ShippingWaybillImportBatch).count() == 1
    assert replacement.filename == "新草稿.xlsx"
    assert replacement.rows[0].tracking_no == "73592817531111"
    assert replacement.rows[0].recipient_name == "待补客户"
