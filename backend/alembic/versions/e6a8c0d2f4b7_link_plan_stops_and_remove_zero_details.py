"""link stopped plans and remove zero-copy placeholders

Revision ID: e6a8c0d2f4b7
Revises: d5f7a9c1e3b6
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection


revision = "e6a8c0d2f4b7"
down_revision = "d5f7a9c1e3b6"
branch_labels = None
depends_on = None


_PLAN_STATUS_SOURCE = "plan_status"
_NO_SHIPMENT_REQUIRED = "no_shipment_required"
_DEFAULT_REASON = "客户要求暂停本期发货"
_QUANTITY_CHECK = "ck_shipping_details_quantity_positive"


def _scalar(connection: Connection, statement: str, params: dict[str, object]) -> int:
    return int(connection.execute(sa.text(statement), params).scalar() or 0)


def _record_log(
    connection: Connection,
    *,
    record_id: int,
    action: str,
    issue_number: int,
    changes: dict[str, object],
    record_name: str,
) -> None:
    connection.execute(sa.text("""
        INSERT INTO operation_logs (
            table_name, record_id, record_name, action, changes,
            user_id, username, issue_number, status
        ) VALUES (
            :table_name, :record_id, :record_name, :action, :changes,
            NULL, '系统迁移', :issue_number, 'success'
        )
    """), {
        "table_name": "shipping_details" if action == "delete_zero_quantity_placeholder"
        else "shipping_fulfillment_adjustments",
        "record_id": record_id,
        "record_name": record_name,
        "action": action,
        "changes": json.dumps(changes, ensure_ascii=False),
        "issue_number": issue_number,
    })


def _remove_invalid_details(connection: Connection) -> None:
    invalid = [dict(row) for row in connection.execute(sa.text("""
        SELECT id, issue_number, quantity, complaint_makeup_item_id,
               order_id, order_item_id, fulfillment_target_id,
               shipped_at, shipped_quantity, tracking_no
        FROM shipping_details
        WHERE quantity IS NULL OR quantity <= 0
        ORDER BY id
    """)).mappings().all()]
    for detail in invalid:
        detail_id = int(detail["id"])
        params = {"detail_id": detail_id}
        dependency_count = sum([
            _scalar(connection, "SELECT COUNT(*) FROM shipping_packages WHERE shipping_detail_id=:detail_id", params),
            _scalar(connection, "SELECT COUNT(*) FROM shipping_package_allocations WHERE shipping_detail_id=:detail_id", params),
            _scalar(connection, "SELECT COUNT(*) FROM shipping_fulfillment_adjustments WHERE shipping_detail_id=:detail_id", params),
            _scalar(connection, "SELECT COUNT(*) FROM shipping_deferrals WHERE shipping_detail_id=:detail_id", params),
            _scalar(connection, "SELECT COUNT(*) FROM shipping_waybill_import_rows WHERE shipping_detail_id=:detail_id", params),
            int(detail["complaint_makeup_item_id"] is not None),
            int(any(detail[field] is not None for field in (
                "order_id", "order_item_id", "fulfillment_target_id",
                "shipped_at", "shipped_quantity", "tracking_no",
            ))),
        ])
        if dependency_count:
            raise RuntimeError(
                f"0份发货明细ID {detail_id} 已关联履约或审计数据，不能自动清理，请先人工核对"
            )
        _record_log(
            connection,
            record_id=detail_id,
            action="delete_zero_quantity_placeholder",
            issue_number=int(detail["issue_number"]),
            changes={
                "quantity": detail["quantity"],
                "source": "alembic:e6a8c0d2f4b7",
            },
            record_name="0份占位明细",
        )
        connection.execute(
            sa.text("DELETE FROM shipping_details WHERE id=:detail_id"),
            params,
        )


def _backfill_stopped_details(connection: Connection) -> None:
    stopped_details = [dict(row) for row in connection.execute(sa.text("""
        SELECT id, issue_number, name, phone, address, channel, company, quantity,
               shipping_requirement, shipped_at, shipped_quantity, tracking_no
        FROM shipping_details
        WHERE status='停发' AND quantity > 0
          AND (source_type IS NULL OR source_type <> 'complaint_makeup')
        ORDER BY issue_number, id
    """)).mappings().all()]
    for detail in stopped_details:
        detail_id = int(detail["id"])
        issue_number = int(detail["issue_number"])
        params = {"detail_id": detail_id}
        physical_conflict = (
            any(detail[field] is not None for field in ("shipped_at", "shipped_quantity", "tracking_no"))
            or _scalar(connection, "SELECT COUNT(*) FROM shipping_packages WHERE shipping_detail_id=:detail_id", params)
            or _scalar(connection, "SELECT COUNT(*) FROM shipping_package_allocations WHERE shipping_detail_id=:detail_id", params)
            or _scalar(
                connection,
                "SELECT COUNT(*) FROM shipping_deferrals WHERE shipping_detail_id=:detail_id AND status='pending'",
                params,
            )
            or _scalar(
                connection,
                """
                SELECT COUNT(*) FROM shipping_fulfillment_adjustments
                WHERE shipping_detail_id=:detail_id AND adjustment_type='warehouse_stock_in'
                """,
                params,
            )
        )
        if physical_conflict:
            raise RuntimeError(
                f"第{issue_number}期停发明细ID {detail_id} 已存在实发、合寄或转库记录，不能自动归因"
            )

        issue_ids = connection.execute(sa.text(
            "SELECT id FROM issues WHERE issue_number=:issue_number ORDER BY id"
        ), {"issue_number": issue_number}).scalars().all()
        if len(issue_ids) != 1:
            raise RuntimeError(f"第{issue_number}期无法唯一关联刊期主记录")

        if detail["shipping_requirement"] == "no_tracking_required":
            connection.execute(sa.text("""
                UPDATE shipping_details
                SET shipping_requirement='tracking_required'
                WHERE id=:detail_id
            """), params)

        existing_no_shipment = _scalar(connection, """
            SELECT COALESCE(SUM(quantity), 0)
            FROM shipping_fulfillment_adjustments
            WHERE shipping_detail_id=:detail_id
              AND adjustment_type='no_shipment_required'
        """, params)
        missing_quantity = max(int(detail["quantity"]) - existing_no_shipment, 0)
        if not missing_quantity:
            continue

        result = connection.execute(sa.text("""
            INSERT INTO shipping_fulfillment_adjustments (
                issue_id, issue_number, shipping_detail_id, adjustment_type, source,
                quantity, reason, detail_name_snapshot, detail_phone_snapshot,
                detail_address_snapshot, detail_channel_snapshot,
                detail_company_snapshot, detail_quantity_snapshot, created_by
            ) VALUES (
                :issue_id, :issue_number, :detail_id, :adjustment_type, :source,
                :quantity, :reason, :name, :phone,
                :address, :channel, :company, :detail_quantity, NULL
            )
        """), {
            "issue_id": int(issue_ids[0]),
            "issue_number": issue_number,
            "detail_id": detail_id,
            "adjustment_type": _NO_SHIPMENT_REQUIRED,
            "source": _PLAN_STATUS_SOURCE,
            "quantity": missing_quantity,
            "reason": _DEFAULT_REASON,
            "name": detail["name"],
            "phone": detail["phone"],
            "address": detail["address"],
            "channel": detail["channel"],
            "company": detail["company"],
            "detail_quantity": int(detail["quantity"]),
        })
        adjustment_id = int(result.lastrowid or 0)
        if not adjustment_id:
            adjustment_id = _scalar(connection, "SELECT MAX(id) FROM shipping_fulfillment_adjustments", {})
        _record_log(
            connection,
            record_id=adjustment_id,
            action="create_plan_stop_adjustment",
            issue_number=issue_number,
            changes={
                "adjustment_type": _NO_SHIPMENT_REQUIRED,
                "source": _PLAN_STATUS_SOURCE,
                "quantity": missing_quantity,
                "shipping_detail_id": detail_id,
                "migration": revision,
            },
            record_name=_DEFAULT_REASON,
        )


def upgrade() -> None:
    op.add_column(
        "shipping_fulfillment_adjustments",
        sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
    )
    op.create_index(
        "ix_shipping_fulfillment_adjustments_source",
        "shipping_fulfillment_adjustments",
        ["source"],
        unique=False,
    )
    connection = op.get_bind()
    _remove_invalid_details(connection)
    with op.batch_alter_table("shipping_details") as batch_op:
        batch_op.alter_column("quantity", existing_type=sa.Integer(), nullable=False)
        batch_op.create_check_constraint(_QUANTITY_CHECK, "quantity > 0")
    _backfill_stopped_details(connection)


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text(
        "DELETE FROM shipping_fulfillment_adjustments WHERE source=:source"
    ), {"source": _PLAN_STATUS_SOURCE})
    with op.batch_alter_table("shipping_details") as batch_op:
        batch_op.drop_constraint(_QUANTITY_CHECK, type_="check")
        batch_op.alter_column("quantity", existing_type=sa.Integer(), nullable=True)
    op.drop_index(
        "ix_shipping_fulfillment_adjustments_source",
        table_name="shipping_fulfillment_adjustments",
    )
    op.drop_column("shipping_fulfillment_adjustments", "source")
    # 0份占位数据按业务定义无意义，降级不会恢复已清理的占位行。
