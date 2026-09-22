"""销售来源修复命令。默认仅生成只读预览；执行必须指定已核对文件、管理员及原因。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.database import engine
from app.models.user import User
from app.services.order_source_repair_service import apply_repair, preview_repair


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preview', type=Path, help='保存只读预览（建议放入 Git 忽略的 backups 目录）')
    mode.add_argument('--apply', type=Path, help='执行人工核对并修改 resolutions 后的预览文件')
    parser.add_argument('--operator', help='管理员用户名')
    parser.add_argument('--reason', help='明确的核对与修复原因')
    args = parser.parse_args()
    try:
        if args.preview:
            destination = args.preview.resolve()
            root = Path(__file__).resolve().parents[2]
            if destination.is_relative_to(root) and not destination.is_relative_to(root / 'backups'):
                parser.error('业务修复预览不得写入可提交目录；请使用仓库 backups/ 或仓库外路径')
            with engine.connect() as connection:
                if engine.dialect.name == 'mysql':
                    connection.exec_driver_sql('SET TRANSACTION READ ONLY')
                    connection.exec_driver_sql('START TRANSACTION WITH CONSISTENT SNAPSHOT')
                with Session(bind=connection, autoflush=False) as db:
                    plan = preview_repair(db)
                    db.rollback()
                connection.rollback()
            destination.parent.mkdir(parents=True, exist_ok=True)
            # 独占创建，避免覆盖用户已核对的决定；文件仅当前用户可读写。
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                json.dump(plan, output, ensure_ascii=False, indent=2)
                output.write('\n')
            print(json.dumps({'preview_file': str(destination),
                              'normalize_orders': len(plan['normalizations']['orders']),
                              'normalize_sources': len(plan['normalizations']['sources']),
                              'duplicate_groups': len(plan['duplicate_groups']),
                              'source_conflicts': len(plan['source_identity_conflicts'])}, ensure_ascii=False))
        else:
            if not args.operator or not args.reason:
                parser.error('--apply 必须同时指定 --operator 和 --reason')
            plan = json.loads(args.apply.read_text())
            with Session(engine, autoflush=False) as db:
                operator = db.query(User).filter(User.username == args.operator).one_or_none()
                if operator is None:
                    raise HTTPException(403, '管理员操作人不存在')
                operator_id = operator.id
                db.rollback()  # 清掉查用户的快照，修复在锁内重新核对。
                result = apply_repair(db, plan, operator_id=operator_id, reason=args.reason)
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except HTTPException as exc:
        print(f'修复未执行或已回滚：{exc.detail}', file=sys.stderr)
    except Exception as exc:
        # 不回显数据库 URL、凭据或包含业务参数的底层异常。
        print(f'修复未完成：{type(exc).__name__}；请检查配置或预览文件，禁止自动重试写入。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
