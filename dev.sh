#!/usr/bin/env bash
# 中国经营报 · 印数报数系统 - 本地开发一键启动 (macOS / Linux)
# 用法: 在项目根目录运行 ./dev.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 启动印数报数系统（开发模式）..."

# 检查 .env
if [ ! -f "$ROOT/.env" ]; then
    echo "❌ 缺少 .env 文件，请先创建！"
    exit 1
fi

# 检查 Python venv
if [ ! -d "$ROOT/backend/venv" ]; then
    echo "⚙️  创建 Python 虚拟环境..."
    python3 -m venv "$ROOT/backend/venv"
    source "$ROOT/backend/venv/bin/activate"
    pip install -r "$ROOT/backend/requirements.txt" -q
else
    source "$ROOT/backend/venv/bin/activate"
fi

# 检查 node_modules
if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "⚙️  安装前端依赖..."
    cd "$ROOT/frontend" && npm install
    cd "$ROOT"
fi

# 启动后端（后台运行）
echo "🐍 启动后端 (http://localhost:8000) ..."
cd "$ROOT/backend"
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

sleep 3

# 启动前端（后台运行）
echo "⚛️  启动前端 (http://localhost:5173) ..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

sleep 2
echo ""
echo "✅ 开发环境已启动！"
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:8000"
echo "   API:  http://localhost:8000/docs"
echo ""
echo "按 Ctrl+C 停止所有服务。"

# 捕获 Ctrl+C，优雅退出
cleanup() {
    echo ""
    echo "🛑 正在停止服务..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo "已停止。"
    exit 0
}
trap cleanup SIGINT SIGTERM

# 等待子进程
wait
