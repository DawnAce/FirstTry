"""reconcile Mafei warehouse retention as stock-in adjustments

Revision ID: d5f7a9c1e3b6
Revises: c3e5a7b9d1f4
"""

from __future__ import annotations

from collections import Counter, defaultdict
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection


revision = "d5f7a9c1e3b6"
down_revision = "c3e5a7b9d1f4"
branch_labels = None
depends_on = None


_STOCK_IN_TYPE = "warehouse_stock_in"
_STOCK_IN_REASON = "转库留存 · 当期报纸入马飞中通库房备货"
_IMPORT_CONVERSION_REASON = "历史转换：马飞—库房留存已改为转库留存/库存入库"


def _scalar(connection: Connection, statement: str, params: dict[str, object]) -> int:
    return int(connection.execute(sa.text(statement), params).scalar() or 0)


def _preflight_detail(connection: Connection, detail: dict[str, object]) -> None:
    detail_id = int(detail["id"])
    issue_number = int(detail["issue_number"])
    params = {"detail_id": detail_id}
    direct_packages = _scalar(
        connection,
        "SELECT COUNT(*) FROM shipping_packages WHERE shipping_detail_id=:detail_id",
        params,
    )
    allocations = _scalar(
        connection,
        "SELECT COUNT(*) FROM shipping_package_allocations WHERE shipping_detail_id=:detail_id",
        params,
    )
    active_deferrals = _scalar(
        connection,
        """
        SELECT COUNT(*) FROM shipping_deferrals
        WHERE shipping_detail_id=:detail_id AND status <> 'cancelled'
        """,
        params,
    )
    tracked_import_rows = _scalar(
        connection,
        """
        SELECT COUNT(*) FROM shipping_waybill_import_rows
        WHERE shipping_detail_id=:detail_id
          AND match_status='matched'
          AND no_tracking_required=0
        """,
        params,
    )
    has_legacy_physical_shipment = any(
        detail.get(field) is not None
        for field in ("shipped_at", "shipped_quantity", "tracking_no")
    )
    if direct_packages or allocations or active_deferrals or tracked_import_rows or has_legacy_physical_shipment:
        raise RuntimeError(
            "马飞—库房留存历史转换检测到真实发货冲突："
            f"第{issue_number}期明细ID {detail_id}，"
            f"直接运单{direct_packages}、分摊运单{allocations}、"
            f"延期记录{active_deferrals}、有单号导入行{tracked_import_rows}、"
            f"旧实发标记{int(has_legacy_physical_shipment)}。请先人工核对。"
        )


def _load_adjustments(connection: Connection, detail: dict[str, object]) -> list[dict[str, object]]:
    return [dict(row) for row in connection.execute(sa.text("""
        SELECT id, shipping_detail_id, adjustment_type, quantity, reason
        FROM shipping_fulfillment_adjustments
        WHERE shipping_detail_id=:detail_id
           OR (
               shipping_detail_id IS NULL
               AND issue_number=:issue_number
               AND TRIM(COALESCE(detail_name_snapshot, ''))='马飞'
               AND TRIM(COALESCE(detail_channel_snapshot, ''))='库房留存'
           )
        ORDER BY id
    """), {
        "detail_id": int(detail["id"]),
        "issue_number": int(detail["issue_number"]),
    }).mappings().all()]


def _record_migration_log(
    connection: Connection,
    *,
    adjustment_id: int,
    detail: dict[str, object],
    quantity: int,
) -> None:
    changes = json.dumps({
        "adjustment_type": _STOCK_IN_TYPE,
        "quantity": quantity,
        "shipping_detail_id": int(detail["id"]),
        "source": "alembic:d5f7a9c1e3b6",
    }, ensure_ascii=False)
    connection.execute(sa.text("""
        INSERT INTO operation_logs (
            table_name, record_id, record_name, action, changes,
            user_id, username, issue_number, channel, status
        ) VALUES (
            'shipping_fulfillment_adjustments', :record_id, :record_name, 'create', :changes,
            NULL, '系统迁移', :issue_number, '库房留存', 'success'
        )
    """), {
        "record_id": adjustment_id,
        "record_name": _STOCK_IN_REASON,
        "changes": changes,
        "issue_number": int(detail["issue_number"]),
    })


def _upgrade_connection(connection: Connection) -> None:
    details = [dict(row) for row in connection.execute(sa.text("""
        SELECT id, issue_number, name, channel, phone, address, company, quantity,
               shipping_requirement, shipped_at, shipped_quantity, tracking_no
        FROM shipping_details
        WHERE TRIM(name)='马飞' AND TRIM(channel)='库房留存'
        ORDER BY issue_number, id
    """)).mappings().all()]
    if not details:
        return

    duplicate_issues = [
        issue_number
        for issue_number, count in Counter(int(item["issue_number"]) for item in details).items()
        if count > 1
    ]
    if duplicate_issues:
        joined = "、".join(str(value) for value in sorted(duplicate_issues))
        raise RuntimeError(f"同一期存在多条马飞—库房留存明细，无法自动转换：{joined}")

    issue_numbers = {int(item["issue_number"]) for item in details}
    issue_ids = {}
    for issue_number in issue_numbers:
        rows = connection.execute(sa.text(
            "SELECT id FROM issues WHERE issue_number=:issue_number ORDER BY id"
        ), {"issue_number": issue_number}).scalars().all()
        if len(rows) != 1:
            raise RuntimeError(f"第{issue_number}期无法唯一关联刊期主记录")
        issue_ids[issue_number] = int(rows[0])

    batch_before: dict[int, dict[str, object]] = {}
    for issue_number in issue_numbers:
        for row in connection.execute(sa.text("""
            SELECT id, issue_number, status, expected_quantity,
                   pending_quantity, extra_quantity
            FROM shipping_waybill_import_batches
            WHERE issue_number=:issue_number
        """), {"issue_number": issue_number}).mappings().all():
            batch_before[int(row["id"])] = dict(row)

    issue_handled_delta: dict[int, int] = defaultdict(int)
    removed_preview_match: dict[int, int] = defaultdict(int)

    for detail in details:
        _preflight_detail(connection, detail)
        detail_id = int(detail["id"])
        issue_number = int(detail["issue_number"])
        quantity = max(int(detail["quantity"] or 0), 0)
        adjustments = _load_adjustments(connection, detail)
        adjustment_total = sum(max(int(item["quantity"] or 0), 0) for item in adjustments)
        if adjustment_total > quantity:
            raise RuntimeError(
                f"第{issue_number}期马飞库房已有核销{adjustment_total}份，超过计划{quantity}份"
            )

        old_handled = quantity if detail["shipping_requirement"] == "no_tracking_required" else min(
            adjustment_total,
            quantity,
        )
        issue_handled_delta[issue_number] += quantity - old_handled

        for adjustment in adjustments:
            connection.execute(sa.text("""
                UPDATE shipping_fulfillment_adjustments
                SET shipping_detail_id=:detail_id,
                    adjustment_type=:adjustment_type,
                    reason=:reason,
                    detail_name_snapshot='马飞',
                    detail_phone_snapshot=:phone,
                    detail_address_snapshot=:address,
                    detail_channel_snapshot='库房留存',
                    detail_company_snapshot=:company,
                    detail_quantity_snapshot=:detail_quantity
                WHERE id=:adjustment_id
            """), {
                "detail_id": detail_id,
                "adjustment_type": _STOCK_IN_TYPE,
                "reason": _STOCK_IN_REASON,
                "phone": detail["phone"],
                "address": detail["address"],
                "company": detail["company"],
                "detail_quantity": quantity,
                "adjustment_id": int(adjustment["id"]),
            })

        inserted_adjustment_id: int | None = None
        missing_quantity = quantity - adjustment_total
        if missing_quantity:
            result = connection.execute(sa.text("""
                INSERT INTO shipping_fulfillment_adjustments (
                    issue_id, issue_number, shipping_detail_id, adjustment_type,
                    quantity, reason, detail_name_snapshot, detail_phone_snapshot,
                    detail_address_snapshot, detail_channel_snapshot,
                    detail_company_snapshot, detail_quantity_snapshot, created_by
                ) VALUES (
                    :issue_id, :issue_number, :detail_id, :adjustment_type,
                    :quantity, :reason, '马飞', :phone,
                    :address, '库房留存', :company, :detail_quantity, NULL
                )
            """), {
                "issue_id": issue_ids[issue_number],
                "issue_number": issue_number,
                "detail_id": detail_id,
                "adjustment_type": _STOCK_IN_TYPE,
                "quantity": missing_quantity,
                "reason": _STOCK_IN_REASON,
                "phone": detail["phone"],
                "address": detail["address"],
                "company": detail["company"],
                "detail_quantity": quantity,
            })
            inserted_adjustment_id = int(result.lastrowid)
            _record_migration_log(
                connection,
                adjustment_id=inserted_adjustment_id,
                detail=detail,
                quantity=missing_quantity,
            )

        import_rows = connection.execute(sa.text("""
            SELECT id, batch_id, quantity, match_status, no_tracking_required
            FROM shipping_waybill_import_rows
            WHERE shipping_detail_id=:detail_id AND match_status <> 'ignored'
            ORDER BY id
        """), {"detail_id": detail_id}).mappings().all()
        for row in import_rows:
            if row["match_status"] == "matched" and bool(row["no_tracking_required"]):
                batch_id = int(row["batch_id"])
                before = batch_before.get(batch_id)
                if before and before["status"] == "previewed":
                    removed_preview_match[batch_id] += max(int(row["quantity"] or 0), 0)
            connection.execute(sa.text("""
                UPDATE shipping_waybill_import_rows
                SET match_status='ignored',
                    match_reason=:reason,
                    manual_reviewed=1
                WHERE id=:row_id
            """), {"reason": _IMPORT_CONVERSION_REASON, "row_id": int(row["id"])})

        connection.execute(sa.text("""
            UPDATE shipping_details
            SET shipping_requirement='tracking_required',
                shipped_at=NULL,
                shipped_quantity=NULL,
                tracking_no=NULL
            WHERE id=:detail_id
        """), {"detail_id": detail_id})

    for batch_id, before in batch_before.items():
        row_values = connection.execute(sa.text("""
            SELECT quantity, match_status
            FROM shipping_waybill_import_rows
            WHERE batch_id=:batch_id
        """), {"batch_id": batch_id}).mappings().all()
        matched_quantity = sum(
            max(int(row["quantity"] or 0), 0)
            for row in row_values
            if row["match_status"] == "matched"
        )
        matched_rows = sum(1 for row in row_values if row["match_status"] == "matched")
        unmatched_rows = sum(
            1 for row in row_values if row["match_status"] not in {"matched", "ignored"}
        )
        expected = max(int(before["expected_quantity"] or 0), 0)
        old_projected = expected - int(before["pending_quantity"] or 0) + int(before["extra_quantity"] or 0)
        issue_number = int(before["issue_number"])
        new_projected = old_projected + issue_handled_delta[issue_number]
        if before["status"] == "previewed":
            new_projected -= removed_preview_match[batch_id]
        connection.execute(sa.text("""
            UPDATE shipping_waybill_import_batches
            SET matched_quantity=:matched_quantity,
                matched_rows=:matched_rows,
                unmatched_rows=:unmatched_rows,
                pending_quantity=:pending_quantity,
                extra_quantity=:extra_quantity
            WHERE id=:batch_id
        """), {
            "matched_quantity": matched_quantity,
            "matched_rows": matched_rows,
            "unmatched_rows": unmatched_rows,
            "pending_quantity": max(expected - new_projected, 0),
            "extra_quantity": max(new_projected - expected, 0),
            "batch_id": batch_id,
        })


def upgrade() -> None:
    _upgrade_connection(op.get_bind())


def downgrade() -> None:
    # This migration changes historical business classification without adding
    # schema. Reversing it would turn verified stock receipts back into false
    # shipments, so downgrade intentionally preserves the corrected data.
    pass
