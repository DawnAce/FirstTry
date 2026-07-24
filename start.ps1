# 中国经营报 · 印数管理系统 — 生产启动：构建前端 → 应用数据库迁移 → 起服务
# 用法: 在项目根目录运行  .\start.ps1
#   $env:PORT=8000      监听端口（默认 8000）
#   $env:SKIP_BUILD=1   跳过前端构建（dist 已是最新时，仅迁移 + 起服务）
#
# 迁移这步是生产/升级的必做项：新版本代码新增的数据库列要靠它补到生产库，
# 漏了会让导入/统计接口报 Unknown column 500。alembic upgrade head 幂等，已应用过
# 的版本会跳过。
$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot
$PORT = if ($env:PORT) { $env:PORT } else { "8000" }
$PY = "$ROOT\backend\venv\Scripts\python.exe"

if (-not (Test-Path "$ROOT\.env")) {
    Write-Host "❌ 缺少 .env（MySQL 连接配置），请先在项目根目录创建。" -ForegroundColor Red
    exit 1
}

# Python venv（首次自动创建；每次部署同步锁定依赖）
if (-not (Test-Path $PY)) {
    Write-Host "⚙️  创建 Python 虚拟环境..." -ForegroundColor Yellow
    python -m venv "$ROOT\backend\venv"
}
Write-Host "📦 同步后端依赖..." -ForegroundColor Yellow
& $PY -m pip install -r "$ROOT\backend\requirements.txt" -q

# 1) 构建前端（生产模式下 uvicorn 直接托管 frontend/dist）
if ($env:SKIP_BUILD -eq "1") {
    Write-Host "⏭  跳过前端构建 (SKIP_BUILD=1)" -ForegroundColor DarkGray
} else {
    Write-Host "📦 构建前端..." -ForegroundColor Yellow
    Push-Location "$ROOT\frontend"
    npm ci --no-audit --no-fund
    npm run build
    Pop-Location
}

# 2) 应用数据库迁移（幂等；失败即中止，不带半截库结构起服务）
Write-Host "🗄️  应用数据库迁移 (alembic upgrade head)..." -ForegroundColor Yellow
Push-Location "$ROOT\backend"
& $PY -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head 失败（退出码 $LASTEXITCODE）" }
Pop-Location

# 3) 起服务（生产：不开 --reload）
Write-Host "🚀 启动后端  http://0.0.0.0:$PORT" -ForegroundColor Green
Set-Location "$ROOT\backend"
& $PY -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
