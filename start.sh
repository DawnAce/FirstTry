#!/usr/bin/env bash
# 中国经营报 · 印数管理系统 — 生产启动：构建前端 → 应用数据库迁移 → 起服务
# 用法: 在项目根目录运行  ./start.sh
#   PORT=8000      监听端口（默认 8000）
#   SKIP_BUILD=1   跳过前端构建（dist 已是最新时，仅迁移 + 起服务）
#
# 迁移这步是生产/升级的必做项：新版本代码新增的数据库列要靠它补到生产库，
# 漏了会让导入/统计接口报 Unknown column 500。alembic upgrade head 幂等，已应用过
# 的版本会跳过；失败则中止、不带半截库结构起服务。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"

if [ ! -f "$ROOT/.env" ]; then
    echo "❌ 缺少 .env（MySQL 连接配置），请先在项目根目录创建。" >&2
    exit 1
fi

# Python venv（首次自动创建；每次部署同步锁定依赖）
if [ ! -d "$ROOT/backend/venv" ]; then
    echo "⚙️  创建 Python 虚拟环境..."
    python3 -m venv "$ROOT/backend/venv"
fi
source "$ROOT/backend/venv/bin/activate"
echo "📦 同步后端依赖..."
python -m pip install -r "$ROOT/backend/requirements.txt" -q

# 1) 构建前端（生产模式下 uvicorn 直接托管 frontend/dist）
if [ "${SKIP_BUILD:-0}" = "1" ]; then
    echo "⏭  跳过前端构建 (SKIP_BUILD=1)"
else
    echo "📦 构建前端..."
    ( cd "$ROOT/frontend" && npm ci --no-audit --no-fund && npm run build )
fi

# 2) 应用数据库迁移（幂等；失败即中止）
echo "🗄️  应用数据库迁移 (alembic upgrade head)..."
( cd "$ROOT/backend" && alembic upgrade head )

# 3) 起服务（生产：不开 --reload）
echo "🚀 启动后端  http://0.0.0.0:${PORT}"
cd "$ROOT/backend"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
