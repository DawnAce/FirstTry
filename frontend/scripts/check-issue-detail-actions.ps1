$dashboard = Get-Content -Path "src\pages\DashboardPage.tsx" -Raw
$reportEditor = Get-Content -Path "src\pages\ReportEditor.tsx" -Raw
$shippingPreview = Get-Content -Path "src\pages\ShippingPreview.tsx" -Raw

$requiredDashboardMarkers = @(
  'className="dashboard-issue-row"',
  'className="dashboard-issue-row-meta"',
  'onClick={() => navigate(`/report/${item.id}`)}',
  '查看详情'
)

$requiredReportMarkers = @(
  'onClick={() => navigate(`/shipping/${issueId}`)}',
  'title={`确认删除第 ${issue.issue_number} 期？`}',
  'await deleteIssue(Number(issueId));'
)

$requiredShippingMarkers = @(
  'useParams<{ issueId: string }>()',
  'onClick={() => navigate(`/report/${issueId}`)}',
  'await deleteIssue(issueId);'
)

$forbiddenDashboardMarkers = @(
  'icon={<EditOutlined />}',
  'icon={<SendOutlined />}',
  'icon={<DeleteOutlined />}'
)

$missing = @()
$missing += $requiredDashboardMarkers | Where-Object { $dashboard -notmatch [regex]::Escape($_) }
$missing += $requiredReportMarkers | Where-Object { $reportEditor -notmatch [regex]::Escape($_) }
$missing += $requiredShippingMarkers | Where-Object { $shippingPreview -notmatch [regex]::Escape($_) }

$presentForbidden = $forbiddenDashboardMarkers | Where-Object { $dashboard -match [regex]::Escape($_) }

if ($missing.Count -gt 0 -or $presentForbidden.Count -gt 0) {
  $parts = @()
  if ($missing.Count -gt 0) {
    $parts += "Missing markers: $($missing -join ', ')"
  }
  if ($presentForbidden.Count -gt 0) {
    $parts += "Forbidden dashboard markers still present: $($presentForbidden -join ', ')"
  }
  Write-Error ($parts -join ' | ')
  exit 1
}

Write-Host "Issue detail actions verified."
