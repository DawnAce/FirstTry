$ProgressPreference = 'SilentlyContinue'

$appContent = (Invoke-WebRequest -UseBasicParsing http://localhost:5173/src/App.tsx).Content

if ($appContent -notmatch "import Dashboard from ['""](/src/pages/[^'""]+)['""]") {
  Write-Error 'Dashboard import path not found in App.tsx module output.'
  exit 1
}

$dashboardModulePath = $matches[1]
$dashboardContent = (Invoke-WebRequest -UseBasicParsing ("http://localhost:5173" + $dashboardModulePath)).Content

if ($dashboardContent.Length -lt 500) {
  Write-Error ("Dashboard dev module is unexpectedly short (" + $dashboardContent.Length + " chars): " + $dashboardModulePath)
  exit 1
}

Write-Host ("Dashboard dev module verified: " + $dashboardModulePath)
