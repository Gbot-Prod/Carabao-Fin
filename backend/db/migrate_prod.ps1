<#
.SYNOPSIS
  Run the full "Updating production (new migrations)" procedure in one step.

.DESCRIPTION
  SYSTEM_REFERENCE.md section 6, "Updating production", steps 1 to 8:

  1. Preflight: Docker, uv and npm are available; the URL is a postgres:// URL
     on the Railway TCP proxy (not localhost); the URL reaches Python.
  2. Shows the production Alembic revision and the head.
  3. Asks you to type the database name ONE time. Nothing changes before this.
  4. Backup (backup.ps1). Stops if the restore check fails.
  5. Better Auth migration (npm run auth:migrate, then auth:migrate:apply).
  6. alembic upgrade head, then checks that "alembic current" shows (head).
  7. The data scripts that you select with -Data.
  8. Roles and guards (apply_roles.ps1, no -SetPasswords).
  9. Always removes DATABASE_URL, PGSSL_CA and PGSSL_SERVERNAME from the shell.

  The script stops at the first failure. It does not deploy. Deploy the API,
  then the web app, after it prints "DONE".

  The URL is read at a hidden prompt (or from $env:MIGRATE_DATABASE_URL). It is
  never put in a prompt text or on a command line.

.PARAMETER PgsslCaFile
  A file that holds the PEM from Backend service > Variables > PGSSL_CA.
  Not necessary if $env:PGSSL_CA is already set.

.PARAMETER Data
  The data scripts to run after Alembic. Use the ones whose table is new or
  whose data file changed. Values: psgc, boundaries, terms, phash, prices, all.
  "terms" and "phash" run with --dry-run first.

.PARAMETER SkipBackup
  Do not make a backup. Use only if you made one in the last minutes.

.PARAMETER AllowAnyHost
  Permit a host that is not *.proxy.rlwy.net (for example, a staging DB).
  localhost is never permitted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\db\migrate_prod.ps1 -PgsslCaFile $HOME\railway-ca.pem

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\db\migrate_prod.ps1 -PgsslCaFile $HOME\railway-ca.pem -Data prices,terms
#>
param(
  [string]$PgsslCaFile = "",
  [ValidateSet("psgc", "boundaries", "terms", "phash", "prices", "all")]
  [string[]]$Data = @(),
  [switch]$SkipBackup,
  [switch]$AllowAnyHost
)

# Not "Stop": Windows PowerShell 5.1 turns any stderr line from a native
# command into a terminating error. Failures are caught by exit code instead.
$ErrorActionPreference = "Continue"

$dbDir = $PSScriptRoot
$backendDir = (Resolve-Path (Join-Path $dbDir "..")).Path
$webDir = (Resolve-Path (Join-Path $backendDir "..\frontend\carabao-app")).Path
# Child scripts run in the same PowerShell edition as this one.
$psExe = (Get-Process -Id $PID).Path

function Write-Step([string]$Text) {
  Write-Host ""
  Write-Host "== $Text" -ForegroundColor Cyan
}

function Invoke-Native {
  # Run a native command and stop on a non-zero exit code.
  param([string]$What, [scriptblock]$Cmd)
  & $Cmd
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Invoke-In([string]$Dir, [string]$What, [scriptblock]$Cmd) {
  Push-Location $Dir
  try { Invoke-Native $What $Cmd } finally { Pop-Location }
}

$envNames = "DATABASE_URL", "PGSSL_CA", "PGSSL_SERVERNAME", "BACKUP_DATABASE_URL", "APPLY_DATABASE_URL"
$started = Get-Date
$completed = @()

try {
  # ── 1. Preflight ──────────────────────────────────────────────────────────
  Write-Step "1. Preflight"
  foreach ($tool in "docker", "uv", "npm") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
  }
  docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop." }

  if ($PgsslCaFile) {
    if (-not (Test-Path $PgsslCaFile)) { throw "PgsslCaFile not found: $PgsslCaFile" }
    $ca = (Get-Content -Raw $PgsslCaFile).Trim()
  } else {
    $ca = "$env:PGSSL_CA".Trim()
  }
  if ($ca -notmatch '-----BEGIN CERTIFICATE-----') {
    throw "No PGSSL_CA PEM. Save the Backend service's PGSSL_CA to a file and use -PgsslCaFile."
  }

  $url = $env:MIGRATE_DATABASE_URL
  if (-not $url) {
    $secure = Read-Host "Superuser DATABASE_PUBLIC_URL" -AsSecureString
    $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  $url = "$url".Trim()
  if (-not $url) { throw "Empty URL. Nothing was changed." }
  if ($url -notmatch '^postgres(ql)?://') { throw "That does not look like a postgres:// URL." }

  $target = [uri]($url -replace '^postgres(ql)?://', 'http://')
  $targetHost = $target.Host
  $database = $target.AbsolutePath.TrimStart('/')
  if (-not $database) { throw "The URL has no database name." }
  if ($targetHost -in @("localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal")) {
    throw "The URL points to $targetHost. This script is for the production DB only."
  }
  if (-not $AllowAnyHost -and $targetHost -notlike "*.proxy.rlwy.net") {
    throw "Host $targetHost is not *.proxy.rlwy.net. Use DATABASE_PUBLIC_URL, or -AllowAnyHost."
  }

  $env:DATABASE_URL = $url
  $env:BACKUP_DATABASE_URL = $url
  $env:APPLY_DATABASE_URL = $url
  $env:PGSSL_CA = $ca
  $env:PGSSL_SERVERNAME = "localhost"

  # Prove the value reaches the child processes (not the .env fallback).
  Push-Location $backendDir
  try {
    $seen = uv run python -c "import os; print(os.environ['DATABASE_URL'].split('@')[1])"
    if ($LASTEXITCODE -ne 0) { throw "Python could not read DATABASE_URL." }
  } finally { Pop-Location }
  $seen = "$(@($seen)[-1])".Trim()
  if ($seen -notlike "$targetHost*") { throw "Python sees '$seen', not $targetHost. Stop." }
  Write-Host "Target: $seen"

  # ── 2. Look ───────────────────────────────────────────────────────────────
  Write-Step "2. Alembic state"
  Push-Location $backendDir
  try {
    $current = uv run alembic current 2>$null
    if ($LASTEXITCODE -ne 0) { throw "alembic current failed. Check the URL and PGSSL_CA." }
    $heads = uv run alembic heads 2>$null
    if ($LASTEXITCODE -ne 0) { throw "alembic heads failed." }
  } finally { Pop-Location }
  Write-Host "Production: $(($current | Out-String).Trim())"
  Write-Host "Code head:  $(($heads | Out-String).Trim())"
  $dataList = if ($Data -contains "all") { "psgc, boundaries, terms, phash, prices" } elseif ($Data) { $Data -join ", " } else { "none" }
  Write-Host "Backup:     $(if ($SkipBackup) { 'SKIPPED' } else { 'yes' })"
  Write-Host "Data:       $dataList"

  # ── 3. Confirm (the only question) ───────────────────────────────────────
  Write-Host ""
  $typed = Read-Host "Type the database name ($database) to migrate $targetHost"
  if ($typed -ne $database) { throw "Not confirmed. Nothing was changed." }

  # ── 4. Backup ─────────────────────────────────────────────────────────────
  if (-not $SkipBackup) {
    Write-Step "4. Backup"
    Invoke-Native "backup.ps1" { & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dbDir "backup.ps1") }
    $completed += "backup"
  }

  # ── 5. Better Auth ────────────────────────────────────────────────────────
  Write-Step "5. Better Auth migration"
  Invoke-In $webDir "npm run auth:migrate" { npm run auth:migrate }
  Invoke-In $webDir "npm run auth:migrate:apply" { npm run auth:migrate:apply }
  $completed += "better-auth"

  # ── 6. Alembic ────────────────────────────────────────────────────────────
  Write-Step "6. Alembic upgrade"
  Invoke-In $backendDir "alembic upgrade head" { uv run alembic upgrade head }
  Push-Location $backendDir
  try { $after = uv run alembic current 2>$null } finally { Pop-Location }
  if (($after | Out-String) -notmatch '\(head\)') { throw "alembic current does not show (head): $after" }
  Write-Host "Now: $(($after | Out-String).Trim())"
  $completed += "alembic"

  # ── 7. Data ───────────────────────────────────────────────────────────────
  $all = $Data -contains "all"
  $jobs = @(
    @{ Key = "psgc";       Script = "scripts/load_psgc.py";             DryRun = $false },
    @{ Key = "boundaries"; Script = "scripts/load_psgc_boundaries.py";  DryRun = $false },
    @{ Key = "terms";      Script = "scripts/load_prohibited_terms.py"; DryRun = $true },
    @{ Key = "phash";      Script = "scripts/backfill_photo_hashes.py"; DryRun = $true },
    @{ Key = "prices";     Script = "scripts/sync_da_prices.py";        DryRun = $false }
  )
  $selected = @($jobs | Where-Object { $all -or $Data -contains $_.Key })
  if ($selected) {
    Write-Step "7. Data scripts"
    foreach ($job in $selected) {
      $py = $job.Script
      if ($job.DryRun) {
        Write-Host "-- $py --dry-run"
        Invoke-In $backendDir "$py --dry-run" { uv run python $py --dry-run }
      }
      Write-Host "-- $py"
      Invoke-In $backendDir $py { uv run python $py }
      $completed += $job.Key
    }
  }

  # ── 8. Roles and guards ───────────────────────────────────────────────────
  Write-Step "8. Roles and guards"
  Invoke-Native "apply_roles.ps1" {
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dbDir "apply_roles.ps1") -ConfirmDatabase $database
  }
  $completed += "roles"

  $minutes = "{0:N1}" -f ((Get-Date) - $started).TotalMinutes
  Write-Host ""
  Write-Host "DONE on $targetHost / $database in $minutes min." -ForegroundColor Green
  Write-Host "Next: set any new env vars (4.1), deploy the API, then the web app, then do the post-deploy checks."
}
catch {
  Write-Host ""
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Completed steps: $(if ($completed) { $completed -join ', ' } else { 'none' })"
  if ($completed -contains "better-auth" -or $completed -contains "alembic") {
    Write-Host "The DB is partly migrated. Do not deploy. Fix and run again, or roll back:" -ForegroundColor Yellow
    Write-Host "  pg_restore --clean --no-owner the dump from step 4, run apply_roles.ps1, redeploy the previous commit."
  }
  exit 1
}
finally {
  # Step 8 of the manual procedure: never leave the production URL in the shell.
  foreach ($n in $envNames) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
  $url = $null; $ca = $null
}
