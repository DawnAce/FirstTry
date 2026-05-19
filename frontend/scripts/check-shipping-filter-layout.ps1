$content = Get-Content -Path "src\pages\Recipients.tsx" -Raw

$requiredMarkers = @(
  'className="shipping-detail-filter-panel"',
  'className="shipping-detail-filter-row shipping-detail-filter-row--issue"',
  'className="shipping-detail-filter-row shipping-detail-filter-row--channel"',
  'className="shipping-detail-filter-row shipping-detail-filter-row--rest"',
  'className="shipping-detail-filter-row shipping-detail-filter-row--footer"',
  'className="shipping-detail-filter-search"',
  'className="shipping-detail-filter-tail"'
)

$missing = $requiredMarkers | Where-Object { $content -notmatch [regex]::Escape($_) }

if ($missing.Count -gt 0) {
  Write-Error ("Missing shipping detail layout markers: " + ($missing -join ', '))
  exit 1
}

Write-Host "Shipping detail layout markers verified."
