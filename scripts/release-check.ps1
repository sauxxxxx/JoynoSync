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
  "docs/lead-import-workflow.md",
  ".env.example",
  "public/index.html",
  "public/src/app.js",
  "public/src/modules/avatar-tone.js",
  "public/src/modules/call-workflow.js",
  "public/src/modules/integration-marketplace.js",
  "public/src/modules/lead-admin-view.js",
  "public/src/modules/lead-assignment-policy.js",
  "public/src/modules/lead-attempt-policy.js",
  "public/src/modules/lead-qualification-policy.js",
  "public/src/modules/lead-import-file.js",
  "public/src/modules/lead-import-results.js",
  "public/src/modules/lead-import-review-view.js",
  "public/src/modules/lead-import-workspace-review.js",
  "public/src/modules/login-showcase.js",
  "public/src/modules/local-qa-session.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/calendar.js",
  "public/src/views/kanban.js",
  "public/src/views/notifications.js",
  "public/src/views/crm.js",
  "public/src/views/integrations.js",
  "public/src/supabase/integrations.js",
  "public/src/supabase/lead-attempts.js",
  "public/src/supabase/lead-import-results.js",
  "public/src/supabase/lead-import-review.js",
  "public/styles/sections/lead-admin-view.css",
  "public/styles/sections/lead-admin-table.css",
  "public/styles/sections/lead-admin-reference-desktop.css",
  "public/styles/sections/lead-import-notion.css",
  "public/styles/sections/lead-import-notion-responsive.css",
  "public/styles/sections/lead-import-review-notion.css",
  "public/styles/sections/lead-import-review-notion-responsive.css",
  "public/styles/sections/lead-import-assignment-notion.css",
  "public/styles/sections/lead-import-controls-notion.css",
  "public/styles/sections/auth-login-reference.css",
  "public/styles/sections/auth-login-progress.css",
  "public/styles/sections/auth-login-viewport.css",
  "public/styles/sections/dashboard-compact-header.css",
  "public/styles/sections/sidebar-reference.css",
  "firebase.json",
  "playwright.config.js",
  "tests/unit/lead-admin-view.test.js",
  "tests/unit/avatar-tone.test.js",
  "tests/unit/lead-assignment-policy.test.js",
  "tests/unit/lead-qualification-policy.test.js",
  "tests/smoke/admin-leads-reference.spec.js",
  "tests/smoke/app-shell.spec.js",
  "tests/smoke/lead-import-ui.spec.js",
  "tests/unit/lead-import-policy.test.js",
  "tests/unit/lead-attempt-policy.test.js",
  "tests/unit/lead-import-file.test.js",
  "tests/unit/lead-import-results.test.js",
  "supabase/migrations/202608030001_lead_round_trip_import.sql",
  "supabase/migrations/202608110001_lead_import_result_details.sql",
  "supabase/migrations/202608110002_unified_lead_attempts.sql",
  "supabase/migrations/202608110003_reassign_and_restart_leads.sql",
  "supabase/migrations/202608110004_repair_import_status_resets.sql",
  "supabase/migrations/202608110005_repair_activity_semantics.sql",
  "supabase/migrations/202608110006_authoritative_lead_import_review.sql",
  "supabase/migrations/202608120001_optimize_authoritative_lead_import_review.sql",
  "supabase/migrations/202608200001_qualified_lead_handoff.sql",
  "supabase/migrations/202608200002_leads_cursor_created_sort.sql",
  "supabase/migrations/202608200003_configure_lynn_qualified_owner.sql",
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
  "public/src/modules/avatar-tone.js",
  "public/src/modules/lead-import-policy.js",
  "public/src/modules/lead-assignment-policy.js",
  "public/src/modules/lead-attempt-policy.js",
  "public/src/modules/lead-qualification-policy.js",
  "public/src/modules/lead-import-file.js",
  "public/src/modules/lead-import-results.js",
  "public/src/modules/lead-import-review-view.js",
  "public/src/modules/lead-import-workspace-review.js",
  "public/src/modules/lead-export-roundtrip.js",
  "public/src/modules/lead-pagination.js",
  "public/src/modules/call-workflow.js",
  "public/src/modules/integration-marketplace.js",
  "public/src/modules/login-showcase.js",
  "public/src/modules/local-qa-session.js",
  "public/src/routes.js",
  "public/src/views/integrations.js",
  "public/src/views/settings.js",
  "public/src/views/extended.js",
  "public/src/views/calendar.js",
  "public/src/views/kanban.js",
  "public/src/views/notifications.js",
  "public/src/views/crm.js",
  "public/src/supabase/team.js",
  "public/src/supabase/work.js",
  "public/src/supabase/messenger.js",
  "public/src/supabase/dashboard.js",
  "public/src/supabase/attendance.js",
  "public/src/supabase/integrations.js",
  "public/src/supabase/lead-attempts.js",
  "public/src/supabase/lead-import-results.js",
  "public/src/supabase/lead-import-review.js"
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

if (-not $env:JOYNO_BROWSER_EXECUTABLE) {
  $browserCandidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )
  $installedBrowser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($installedBrowser) {
    $env:JOYNO_BROWSER_EXECUTABLE = $installedBrowser
    Write-Host "Using installed browser for Playwright: $installedBrowser" -ForegroundColor DarkGray
  }
}

Write-Host "Running dependency security audit..." -ForegroundColor Cyan
Invoke-CheckedCommand "npm.cmd" @("audit", "--audit-level=high")

Write-Host "Running lead lifecycle unit tests..." -ForegroundColor Cyan
Invoke-CheckedCommand "npm.cmd" @("run", "test:unit")

Write-Host "Running Playwright smoke tests..." -ForegroundColor Cyan
Invoke-CheckedCommand "npx.cmd" @("playwright", "test", "--workers=1")
