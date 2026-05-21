"""add issue audit snapshots table

Revision ID: 9d4a7b6c5e2f
Revises: 8f3c2a1b5d7e
Create Date: 2026-05-21 11:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d4a7b6c5e2f'
down_revision: Union[str, None] = '8f3c2a1b5d7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'issue_audit_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('issue_id', sa.Integer(), nullable=False),
        sa.Column('snapshot_type', sa.String(length=20), nullable=False),
        sa.Column('report_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('shipping_total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('delta', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_match', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['issue_id'], ['issues.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_issue_audit_snapshots_created_at'), 'issue_audit_snapshots', ['created_at'], unique=False)
    op.create_index(op.f('ix_issue_audit_snapshots_issue_id'), 'issue_audit_snapshots', ['issue_id'], unique=False)
    op.create_index(op.f('ix_issue_audit_snapshots_snapshot_type'), 'issue_audit_snapshots', ['snapshot_type'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_issue_audit_snapshots_snapshot_type'), table_name='issue_audit_snapshots')
    op.drop_index(op.f('ix_issue_audit_snapshots_issue_id'), table_name='issue_audit_snapshots')
    op.drop_index(op.f('ix_issue_audit_snapshots_created_at'), table_name='issue_audit_snapshots')
    op.drop_table('issue_audit_snapshots')
