# scripts/use-dawnace.ps1
# ---------------------------------------------------------------------------
# 让当前 PowerShell 会话以 DawnAce 身份调用 gh CLI / GitHub REST API。
#
# 适用场景：本机同时有多个 GitHub 账号（如 AceDawn / DawnAce），父进程
# （Copilot CLI、CI 等）已经把 GH_TOKEN 设成了别的账号，但本仓库的
# PR 创建、Issue、Workflow 调用应该用仓库 owner（DawnAce）的身份。
#
# 工作原理：
#   1. 通过 git credential fill 从 Windows Credential Manager 取 DawnAce
#      的 PAT（git push 一直在用同一把 token，所以一定存在）。
#   2. 仅覆盖当前 shell 的 $env:GH_TOKEN，不写 User/Machine 环境变量，
#      不动 ~/.config/gh/hosts.yml，对其它窗口零影响。
#   3. 关闭这个 shell 之后一切自动恢复。
#
# 用法：
#   PS> . .\scripts\use-dawnace.ps1            # 必须 dot-source
#   PS> gh pr create --base main ...           # 此后 gh 都是 DawnAce
#
# 校验：
#   PS> gh api user --jq .login                # 应输出 DawnAce
# ---------------------------------------------------------------------------

# 必须 dot-source 才有效（否则 $env: 只在子进程里短暂生效）
if ($MyInvocation.InvocationName -ne '.') {
    Write-Host "[use-dawnace] 请使用 dot-source 方式运行：" -ForegroundColor Yellow
    Write-Host "  . .\scripts\use-dawnace.ps1" -ForegroundColor Yellow
    Write-Host "（注意开头有一个点和空格）" -ForegroundColor Yellow
    exit 1
}

$gcmInput = "protocol=https`nhost=github.com`nusername=DawnAce`n"
$credLines = $gcmInput | git credential fill 2>$null
if (-not $credLines) {
    Write-Host "[use-dawnace] ❌ 无法从 Git Credential Manager 读取 DawnAce 凭据" -ForegroundColor Red
    Write-Host "  请先执行一次 git push 让 GCM 弹出登录窗口存下 PAT。" -ForegroundColor Red
    return
}

$cred = @{}
$credLines | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { $cred[$matches[1]] = $matches[2] }
}

$user = $cred['username']
$tok  = $cred['password']

if (-not $tok) {
    Write-Host "[use-dawnace] ❌ 凭据里没有 password 字段（token 缺失）" -ForegroundColor Red
    return
}

# 备份原 GH_TOKEN，方便用户需要时手动还原
if ($env:GH_TOKEN -and -not $env:GH_TOKEN_BACKUP) {
    $env:GH_TOKEN_BACKUP = $env:GH_TOKEN
}

$env:GH_TOKEN = $tok

Write-Host "[use-dawnace] ✅ 当前 shell GH_TOKEN 已切换为 " -NoNewline -ForegroundColor Green
Write-Host "$user" -NoNewline -ForegroundColor Cyan
Write-Host " (token len=$($tok.Length))" -ForegroundColor Green
if ($env:GH_TOKEN_BACKUP) {
    Write-Host "[use-dawnace]    原 token 已备份到 `$env:GH_TOKEN_BACKUP" -ForegroundColor DarkGray
}
Write-Host "[use-dawnace]    仅影响本窗口；关闭 / 新开 PowerShell 自动恢复。" -ForegroundColor DarkGray
