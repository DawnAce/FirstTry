"""normalize ambiguous monthly report source display names

Revision ID: f5c7e9a1b3d6
Revises: f3b5d7e9a1c4
Create Date: 2026-08-05
"""

from pathlib import Path
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f5c7e9a1b3d6"
down_revision: Union[str, None] = "f3b5d7e9a1c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CHANNEL_LABELS = {
    "postal": "北京邮发",
    "retail": "北京报零",
    "guangzhou": "广州日报",
    "chengdu": "成都杂志铺",
}
FILENAME_MONTH_RE = re.compile(r"(?<!\d)(20\d{2})年\s*(1[0-2]|0?[1-9])月")


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("""
        SELECT id, channel, original_filename, display_name
        FROM report_source_documents
        WHERE document_type = 'monthly'
    """)).mappings()
    for row in rows:
        match = FILENAME_MONTH_RE.search(row["original_filename"])
        channel_label = CHANNEL_LABELS.get(row["channel"])
        if match is None or channel_label is None:
            continue
        year, month = int(match.group(1)), int(match.group(2))
        suffix = Path(row["original_filename"]).suffix.lower() or ".bin"
        display_name = f"{year}年{month:02d}月_{channel_label}_月度报数{suffix}"
        if display_name == row["display_name"]:
            continue
        bind.execute(
            sa.text("""
                UPDATE report_source_documents
                SET display_name = :display_name
                WHERE id = :document_id
            """),
            {"display_name": display_name, "document_id": row["id"]},
        )


def downgrade() -> None:
    # The former ambiguous generated names are intentionally not restored.
    pass
