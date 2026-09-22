"""从后端目录生成前端选项；--check 用于防止两端漂移，无数据库依赖。"""
import ast
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
module = ast.parse((root / 'backend/app/services/order_source_identity.py').read_text())
catalog = next(ast.literal_eval(node.value) for node in module.body if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == 'SOURCE_CATALOG' for target in node.targets))
expected = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
target = root / 'frontend/src/api/salesSourceCatalog.json'
if '--check' in sys.argv:
    if not target.exists() or target.read_text() != expected:
        raise SystemExit('销售来源选项未同步，请运行 python scripts/generate_sales_sources.py')
else:
    target.write_text(expected)
