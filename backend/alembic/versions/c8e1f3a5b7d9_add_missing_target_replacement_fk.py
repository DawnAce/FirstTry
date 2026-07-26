"""add missing fulfillment target replacement foreign key

Revision ID: c8e1f3a5b7d9
Revises: b7d9f1a3c5e8
"""

from alembic import op
import sqlalchemy as sa


revision = "c8e1f3a5b7d9"
down_revision = "b7d9f1a3c5e8"
branch_labels = None
depends_on = None


def _has_fk() -> bool:
    return any(
        fk.get("constrained_columns") == ["replaced_by_target_id"]
        for fk in sa.inspect(op.get_bind()).get_foreign_keys("fulfillment_targets")
    )


def upgrade() -> None:
    if not _has_fk():
        op.create_foreign_key(
            "fk_ft_replaced_by_target_id",
            "fulfillment_targets",
            "fulfillment_targets",
            ["replaced_by_target_id"],
            ["id"],
        )


def downgrade() -> None:
    if _has_fk():
        op.drop_constraint(
            "fk_ft_replaced_by_target_id",
            "fulfillment_targets",
            type_="foreignkey",
        )
