@echo off
chcp 65001 >nul
echo 🚀 启动印数报数系统（开发模式）...

if not exist ".env" (
    echo ❌ 缺少 .env 文件，请先创建！
    exit /b 1
)

echo 🐍 启动后端 (http://localhost:8000) ...
start "Backend" cmd /k "cd backend && venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo ⚛️  启动前端 (http://localhost:5173) ...
start "Frontend" cmd /k "cd frontend && npm run dev"

timeout /t 2 /nobreak >nul
echo.
echo ✅ 开发环境已启动！
echo    前端: http://localhost:5173
echo    后端: http://localhost:8000
echo    API:  http://localhost:8000/docs
echo.
echo 关闭两个弹出的终端窗口即可停止服务。
