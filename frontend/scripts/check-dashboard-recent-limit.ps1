$content = Get-Content -Path "src\pages\DashboardPage.tsx" -Raw

$requiredMarkers = @(
  'const visibleRecentIssues = recentIssues.slice(0, 3);',
  'visibleRecentIssues.length === 0',
  'visibleRecentIssues.map((item, index) => (',
  'index < visibleRecentIssues.length - 1'
)

$missing = $requiredMarkers | Where-Object { $content -notmatch [regex]::Escape($_) }

if ($missing.Count -gt 0) {
  Write-Error ("Missing dashboard recent limit markers: " + ($missing -join ', '))
  exit 1
}

Write-Host "Dashboard recent issues limit verified."
