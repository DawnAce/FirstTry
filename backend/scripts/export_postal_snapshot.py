"""导出邮局月度快照层（postal_delivery_batches + postal_delivery_rows）为 json 归档。

用途：PR-B 删除月度起投明细/快照层前，在**生产库**上先跑一次，把两张表存量数据落盘归档，
以便日后追溯。删表迁移不可逆，务必先归档。

用法（在 backend 目录、配置好生产 DATABASE_URL 的环境下）：
    python -m scripts.export_postal_snapshot > postal_snapshot_archive_YYYYMMDD.json
或：
    python scripts/export_postal_snapshot.py --out postal_snapshot_archive.json
"""

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text

from app.database import engine


def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return v


def _dump_table(conn, table: str) -> list:
    rows = conn.execute(text(f"SELECT * FROM {table}")).mappings().all()
    return [{k: _jsonable(v) for k, v in dict(r).items()} for r in rows]


def export() -> dict:
    with engine.connect() as conn:
        batches = _dump_table(conn, "postal_delivery_batches")
        rows = _dump_table(conn, "postal_delivery_rows")
    return {
        "exported_at": datetime.now().isoformat(),
        "postal_delivery_batches": batches,
        "postal_delivery_rows": rows,
        "counts": {"batches": len(batches), "rows": len(rows)},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="导出邮局月度快照层为 json 归档")
    ap.add_argument("--out", default=None, help="输出文件路径（缺省写 stdout）")
    args = ap.parse_args()

    data = export()
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"已归档 {data['counts']} → {args.out}", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
