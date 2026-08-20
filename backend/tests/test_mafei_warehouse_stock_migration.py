from datetime import date, datetime
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    Issue,
    IssueStatus,
    OperationLog,
    ShippingDetail,
    ShippingFulfillmentAdjustment,
    ShippingPackage,
    ShippingWaybillImportBatch,
    ShippingWaybillImportRow,
)


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "d5f7a9c1e3b6_reconcile_mafei_warehouse_stock_in.py"
    )
    spec = importlib.util.spec_from_file_location("mafei_stock_reconciliation", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _detail(issue_number: int, quantity: int, *, no_tracking: bool = False) -> ShippingDetail:
    return ShippingDetail(
        issue_number=issue_number,
        sheet_name="每周（对公）",
        channel="库房留存",
        transport="库房留存",
        frequency="周",
        status="正常",
        name="马飞",
        address="中通库房",
        quantity=quantity,
        shipping_requirement="no_tracking_required" if no_tracking else "tracking_required",
    )


def _row(
    batch: ShippingWaybillImportBatch,
    detail: ShippingDetail,
    quantity: int,
    *,
    no_tracking: bool,
    source_row: int,
) -> ShippingWaybillImportRow:
    return ShippingWaybillImportRow(
        batch=batch,
        source_sheet="历史上传",
        source_row=source_row,
        carrier="无需运单" if no_tracking else "中通",
        tracking_no=None,
        recipient_name=detail.name,
        phone=detail.phone,
        address=detail.address,
        quantity=quantity,
        no_tracking_required=no_tracking,
        raw_values=[],
        manual_reviewed=False,
        match_status="matched",
        shipping_detail=detail,
    )


def test_migration_converts_confirmed_and_previewed_no_tracking_rows_idempotently():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        confirmed_issue = Issue(
            issue_number=7001,
            publish_date=date(2026, 1, 5),
            status=IssueStatus.confirmed,
        )
        confirmed_stock = _detail(7001, 74, no_tracking=True)
        confirmed_normal = ShippingDetail(
            issue_number=7001, sheet_name="每周", channel="报社留存",
            transport="库房留存", frequency="周", status="正常", name="报社",
            quantity=1, shipping_requirement="no_tracking_required",
        )
        confirmed_batch = ShippingWaybillImportBatch(
            issue_number=7001,
            filename="confirmed.xlsx",
            file_hash="confirmed",
            status="confirmed",
            expected_quantity=75,
            parsed_quantity=75,
            matched_quantity=75,
            pending_quantity=0,
            extra_quantity=0,
            matched_rows=2,
            unmatched_rows=0,
            warning_count=0,
            confirmed_at=datetime(2026, 1, 5, 12, 0),
        )
        confirmed_stock_row = _row(
            confirmed_batch, confirmed_stock, 74, no_tracking=True, source_row=1
        )
        confirmed_normal_row = _row(
            confirmed_batch, confirmed_normal, 1, no_tracking=True, source_row=2
        )

        preview_issue = Issue(
            issue_number=7002,
            publish_date=date(2026, 1, 12),
            status=IssueStatus.confirmed,
        )
        preview_stock = _detail(7002, 69)
        preview_normal = ShippingDetail(
            issue_number=7002, sheet_name="每周", channel="个人订阅",
            transport="中通物流", frequency="周", status="正常", name="测试读者",
            quantity=100,
        )
        preview_batch = ShippingWaybillImportBatch(
            issue_number=7002,
            filename="preview.xlsx",
            file_hash="preview",
            status="previewed",
            expected_quantity=169,
            parsed_quantity=168,
            matched_quantity=168,
            pending_quantity=1,
            extra_quantity=0,
            matched_rows=2,
            unmatched_rows=0,
            warning_count=0,
        )
        preview_stock_row = _row(
            preview_batch, preview_stock, 68, no_tracking=True, source_row=1
        )
        preview_normal_row = _row(
            preview_batch, preview_normal, 100, no_tracking=True, source_row=2
        )

        partial_issue = Issue(
            issue_number=7003,
            publish_date=date(2026, 1, 19),
            status=IssueStatus.confirmed,
        )
        partial_stock = _detail(7003, 5)
        db.add_all([
            confirmed_issue,
            confirmed_stock,
            confirmed_normal,
            preview_issue,
            preview_stock,
            preview_normal,
            partial_issue,
            partial_stock,
        ])
        db.flush()
        confirmed_batch.issue_id = confirmed_issue.id
        preview_batch.issue_id = preview_issue.id
        db.add_all([
            confirmed_batch,
            confirmed_stock_row,
            confirmed_normal_row,
            preview_batch,
            preview_stock_row,
            preview_normal_row,
        ])
        db.flush()
        db.add(ShippingFulfillmentAdjustment(
            issue_id=partial_issue.id,
            issue_number=7003,
            shipping_detail_id=partial_stock.id,
            adjustment_type="no_shipment_required",
            quantity=2,
            reason="旧无需发货",
        ))
        db.commit()
        confirmed_batch_id = confirmed_batch.id
        preview_batch_id = preview_batch.id

    migration = _load_migration()
    with engine.begin() as connection:
        migration._upgrade_connection(connection)
    # A rerun must not duplicate adjustments, logs, or batch deltas.
    with engine.begin() as connection:
        migration._upgrade_connection(connection)

    with Session(engine) as db:
        stock_details = db.query(ShippingDetail).filter(
            ShippingDetail.name == "马飞",
            ShippingDetail.channel == "库房留存",
        ).order_by(ShippingDetail.issue_number).all()
        assert [item.shipping_requirement for item in stock_details] == [
            "tracking_required", "tracking_required", "tracking_required"
        ]
        stock_totals = dict(db.query(
            ShippingFulfillmentAdjustment.issue_number,
            func.sum(ShippingFulfillmentAdjustment.quantity),
        ).filter(
            ShippingFulfillmentAdjustment.adjustment_type == "warehouse_stock_in"
        ).group_by(ShippingFulfillmentAdjustment.issue_number).all())
        assert stock_totals == {7001: 74, 7002: 69, 7003: 5}
        assert db.query(ShippingFulfillmentAdjustment).count() == 4
        assert db.query(OperationLog).filter(
            OperationLog.username == "系统迁移"
        ).count() == 3

        confirmed_stock_row = db.query(ShippingWaybillImportRow).filter(
            ShippingWaybillImportRow.batch_id == confirmed_batch_id,
            ShippingWaybillImportRow.source_row == 1,
        ).one()
        confirmed_normal_row = db.query(ShippingWaybillImportRow).filter(
            ShippingWaybillImportRow.batch_id == confirmed_batch_id,
            ShippingWaybillImportRow.source_row == 2,
        ).one()
        preview_stock_row = db.query(ShippingWaybillImportRow).filter(
            ShippingWaybillImportRow.batch_id == preview_batch_id,
            ShippingWaybillImportRow.source_row == 1,
        ).one()
        preview_normal_row = db.query(ShippingWaybillImportRow).filter(
            ShippingWaybillImportRow.batch_id == preview_batch_id,
            ShippingWaybillImportRow.source_row == 2,
        ).one()
        assert confirmed_stock_row.match_status == "ignored"
        assert preview_stock_row.match_status == "ignored"
        assert "库存入库" in confirmed_stock_row.match_reason
        assert confirmed_normal_row.match_status == "matched"
        assert preview_normal_row.match_status == "matched"

        confirmed_batch = db.query(ShippingWaybillImportBatch).filter_by(file_hash="confirmed").one()
        preview_batch = db.query(ShippingWaybillImportBatch).filter_by(file_hash="preview").one()
        assert (confirmed_batch.matched_quantity, confirmed_batch.matched_rows) == (1, 1)
        assert (confirmed_batch.pending_quantity, confirmed_batch.extra_quantity) == (0, 0)
        assert (preview_batch.matched_quantity, preview_batch.matched_rows) == (100, 1)
        assert (preview_batch.pending_quantity, preview_batch.extra_quantity) == (0, 0)


def test_migration_stops_before_overwriting_real_warehouse_shipment():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        issue = Issue(
            issue_number=7010,
            publish_date=date(2026, 2, 2),
            status=IssueStatus.confirmed,
        )
        detail = _detail(7010, 1)
        package = ShippingPackage(
            shipping_detail=detail,
            carrier="中通",
            tracking_no="TEST7010",
            quantity=1,
            shipped_at=datetime(2026, 2, 2, 12, 0),
        )
        db.add_all([issue, detail, package])
        db.commit()

    migration = _load_migration()
    with pytest.raises(RuntimeError, match="真实发货冲突"):
        with engine.begin() as connection:
            migration._upgrade_connection(connection)

    with Session(engine) as db:
        detail = db.query(ShippingDetail).filter(ShippingDetail.issue_number == 7010).one()
        assert detail.shipping_requirement == "tracking_required"
        assert db.query(ShippingFulfillmentAdjustment).count() == 0
