$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Running Joynosync release checks..." -ForegroundColor Cyan

$requiredFiles = @(
  "public/index.html",
  "public/src/app.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/work.js",
  "public/src/views/crm.js",
  "firebase.json",
  "playwright.config.js",
  "tests/smoke/app-shell.spec.js",
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

$syntaxTargets = @(
  "public/src/app.js",
  "public/src/routes.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/work.js",
  "public/src/views/crm.js",
  "public/src/supabase/team.js",
  "public/src/supabase/work.js",
  "public/src/supabase/messenger.js",
  "public/src/supabase/dashboard.js",
  "public/src/supabase/attendance.js"
)

foreach ($target in $syntaxTargets) {
  Write-Host "node --check $target" -ForegroundColor DarkGray
  node --check $target
}

if (-not (Test-Path "package.json")) {
  throw "package.json is required for smoke tests."
}

if (-not (Test-Path "node_modules/@playwright/test")) {
  Write-Host "Playwright dependencies are not installed yet." -ForegroundColor Yellow
  Write-Host "Run 'npm install' and then 'npm run test:smoke' before shipping." -ForegroundColor Yellow
  exit 0
}

Write-Host "Running Playwright smoke tests..." -ForegroundColor Cyan
npx playwright test
