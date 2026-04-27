# 中国经营报 · 印数报数系统 - 本地开发一键启动
# 用法: 在项目根目录运行 .\dev.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

Write-Host "🚀 启动印数报数系统（开发模式）..." -ForegroundColor Cyan

# 检查 Python venv
if (-not (Test-Path "$ROOT\backend\venv\Scripts\activate.ps1")) {
    Write-Host "⚙️  创建 Python 虚拟环境..." -ForegroundColor Yellow
    python -m venv "$ROOT\backend\venv"
    & "$ROOT\backend\venv\Scripts\activate.ps1"
    pip install -r "$ROOT\backend\requirements.txt" -q
} 

# 检查 node_modules
if (-not (Test-Path "$ROOT\frontend\node_modules")) {
    Write-Host "⚙️  安装前端依赖..." -ForegroundColor Yellow
    Push-Location "$ROOT\frontend"
    npm install
    Pop-Location
}

# 检查 .env
if (-not (Test-Path "$ROOT\.env")) {
    Write-Host "❌ 缺少 .env 文件，请先创建！" -ForegroundColor Red
    exit 1
}

# 启动后端
Write-Host "🐍 启动后端 (http://localhost:8000) ..." -ForegroundColor Green
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\backend'; & '$ROOT\backend\venv\Scripts\activate.ps1'; uvicorn app.main:app --reload --port 8000" -PassThru

# 等后端就绪
Start-Sleep -Seconds 3

# 启动前端
Write-Host "⚛️  启动前端 (http://localhost:5173) ..." -ForegroundColor Green
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\frontend'; npm run dev" -PassThru

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "✅ 开发环境已启动！" -ForegroundColor Cyan
Write-Host "   前端: http://localhost:5173" -ForegroundColor White
Write-Host "   后端: http://localhost:8000" -ForegroundColor White
Write-Host "   API:  http://localhost:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "关闭两个弹出的终端窗口即可停止服务。" -ForegroundColor DarkGray
