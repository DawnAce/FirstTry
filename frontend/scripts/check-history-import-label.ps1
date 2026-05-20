Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$historyImportPath = Join-Path $PSScriptRoot '..\src\pages\HistoryImport.tsx'
$content = Get-Content -Path $historyImportPath -Raw

$requiredMarkers = @(
  '下载印数导入模板',
  "saveBlob(res.data, '印数导入模板.xlsx');"
)

$forbiddenMarkers = @(
  '下载报数导入模板',
  "saveBlob(res.data, '报数导入模板.xlsx');"
)

$missing = @($requiredMarkers | Where-Object { $content -notmatch [regex]::Escape($_) })
$presentForbidden = @($forbiddenMarkers | Where-Object { $content -match [regex]::Escape($_) })

if ($missing.Count -gt 0 -or $presentForbidden.Count -gt 0) {
  $parts = @()
  if ($missing.Count -gt 0) {
    $parts += "Missing markers: $($missing -join ', ')"
  }
  if ($presentForbidden.Count -gt 0) {
    $parts += "Forbidden markers still present: $($presentForbidden -join ', ')"
  }
  Write-Error ($parts -join ' | ')
  exit 1
}

Write-Host "History import label verified."
