$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Release command failed with exit code $LASTEXITCODE`: $FilePath $($ArgumentList -join ' ')"
  }
}

Write-Host "Running Joynosync release checks..." -ForegroundColor Cyan

$requiredFiles = @(
  "README.md",
  "Project_state.md",
  ".env.example",
  "public/index.html",
  "public/src/app.js",
  "public/src/modules/call-workflow.js",
  "public/src/modules/integration-marketplace.js",
  "public/src/modules/local-qa-session.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/work.js",
  "public/src/views/crm.js",
  "public/src/views/integrations.js",
  "public/src/supabase/integrations.js",
  "firebase.json",
  "playwright.config.js",
  "tests/smoke/app-shell.spec.js",
  "tests/smoke/lead-import-ui.spec.js",
  "tests/unit/lead-import-policy.test.js",
  "supabase/migrations/202608030001_lead_round_trip_import.sql",
  "supabase/migrations/202603160004_messenger_realtime_publication.sql",
  "supabase/migrations/202603160005_dashboard_snapshot.sql",
  "supabase/migrations/202603160006_work_activity_realtime.sql",
  "supabase/migrations/202603160007_team_member_security_hardening.sql",
  "supabase/migrations/202603160008_backend_permission_hardening.sql"
)

foreach ($path in $requiredFiles) {
  if (-not (Test-Path $path)) {
    throw "Missing required release file: $path"
  }
}

Write-Host "Checking repository hygiene..." -ForegroundColor Cyan
Invoke-CheckedCommand "git" @("diff", "--check")
Invoke-CheckedCommand "git" @("diff", "--cached", "--check")

$trackedFiles = & git ls-files
$forbiddenTrackedFiles = @($trackedFiles | Where-Object {
  $normalized = ([string]$_).Replace("\", "/")
  $isSecretEnvironmentFile = $normalized -match "(^|/)\.env($|\.)" -and $normalized -ne ".env.example"
  $isGeneratedArtifact = $normalized -match "(^|/)(node_modules|\.firebase|\.playwright-cli|playwright-report|test-results|blob-report|coverage|output|tmp)(/|$)"
  $isSensitiveFile = $normalized -match "(^|/)(firebase-debug\.log|.*service-account.*\.json|.*firebase-adminsdk.*\.json|.*\.(pem|key|p12|pfx))$"
  $isSecretEnvironmentFile -or $isGeneratedArtifact -or $isSensitiveFile
})

if ($forbiddenTrackedFiles.Count -gt 0) {
  throw "Forbidden generated or sensitive files are tracked: $($forbiddenTrackedFiles -join ', ')"
}

$syntaxTargets = @(
  "public/src/app.js",
  "public/src/modules/lead-import-policy.js",
  "public/src/modules/lead-export-roundtrip.js",
  "public/src/modules/lead-pagination.js",
  "public/src/modules/call-workflow.js",
  "public/src/modules/integration-marketplace.js",
  "public/src/modules/local-qa-session.js",
  "public/src/routes.js",
  "public/src/views/integrations.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/work.js",
  "public/src/views/crm.js",
  "public/src/supabase/team.js",
  "public/src/supabase/work.js",
  "public/src/supabase/messenger.js",
  "public/src/supabase/dashboard.js",
  "public/src/supabase/attendance.js",
  "public/src/supabase/integrations.js"
)

foreach ($target in $syntaxTargets) {
  Write-Host "node --check $target" -ForegroundColor DarkGray
  Invoke-CheckedCommand "node" @("--check", $target)
}

if (-not (Test-Path "package.json")) {
  throw "package.json is required for smoke tests."
}

if (-not (Test-Path "node_modules/@playwright/test")) {
  Write-Host "Playwright dependencies are not installed yet." -ForegroundColor Yellow
  Write-Host "Run 'npm install' and then 'npm run test:smoke' before shipping." -ForegroundColor Yellow
  exit 0
}

Write-Host "Running dependency security audit..." -ForegroundColor Cyan
Invoke-CheckedCommand "npm.cmd" @("audit", "--audit-level=high")

Write-Host "Running lead lifecycle unit tests..." -ForegroundColor Cyan
Invoke-CheckedCommand "npm.cmd" @("run", "test:unit")

Write-Host "Running Playwright smoke tests..." -ForegroundColor Cyan
Invoke-CheckedCommand "npx.cmd" @("playwright", "test", "--workers=1")
