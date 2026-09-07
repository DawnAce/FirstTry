"""widen operation log action

Revision ID: f2c4e6a8b0d3
Revises: e7b9c1d3f5a8
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "f2c4e6a8b0d3"
down_revision = "e7b9c1d3f5a8"
branch_labels = None
depends_on = None


_ACTION_LENGTH = 50


def upgrade() -> None:
    connection = op.get_bind()
    action_column = next(
        column
        for column in sa.inspect(connection).get_columns("operation_logs")
        if column["name"] == "action"
    )
    current_type = action_column["type"]
    current_length = getattr(current_type, "length", None)
    if current_length is not None and current_length < _ACTION_LENGTH:
        with op.batch_alter_table("operation_logs") as batch_op:
            batch_op.alter_column(
                "action",
                existing_type=current_type,
                type_=sa.String(length=_ACTION_LENGTH),
                existing_nullable=False,
            )


def downgrade() -> None:
    # Do not truncate descriptive action names already stored in audit logs.
    # VARCHAR(50) remains compatible with application revisions expecting 20.
    pass
