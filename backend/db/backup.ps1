<#
.SYNOPSIS
  Back up a Postgres database and prove the backup restores.

.DESCRIPTION
  DB_ROLE_SPLIT_PLAN.md section 8, step 4. Needs Docker; uses the postgres:17
  image, so no local pg_dump is required.

  1. pg_dump (custom format, owners and grants kept) to <OutDir>\carabao-<UTC time>.dump
  2. Restores it into a throwaway postgres:17 container
  3. Compares the exact row count of every table in "public" (source vs restore)
     and prints a SHA-256 of the dump file

  The URL is asked for at a hidden prompt (or read from $env:BACKUP_DATABASE_URL)
  and only ever reaches the containers as an environment variable, never as a
  command-line argument. Use the superuser's public URL: Railway > Postgres >
  Variables > DATABASE_PUBLIC_URL.

  The dump holds password hashes, TOTP secrets and encrypted tax IDs. Keep it
  out of the repo and out of synced folders. The default OutDir is
  %USERPROFILE%\carabao-backups.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\db\backup.ps1
#>
param(
  [string]$OutDir = (Join-Path $env:USERPROFILE "carabao-backups"),
  [string]$Image = "postgres:17"
)

# Not "Stop": Windows PowerShell 5.1 turns any stderr line from a native
# command into a terminating error. Failures are caught by exit code instead.
$ErrorActionPreference = "Continue"

function Invoke-Native {
  # Run a native command and stop on a non-zero exit code.
  param([string]$What, [scriptblock]$Cmd)
  & $Cmd
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

$url = $env:BACKUP_DATABASE_URL
if (-not $url) {
  $secure = Read-Host "Superuser DATABASE_PUBLIC_URL" -AsSecureString
  $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($url -notmatch '^postgres(ql)?://') { throw "That does not look like a postgres:// URL." }

New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z"
$name = "carabao-$stamp.dump"
$dumpPath = Join-Path $OutDir $name

# Exact row count per table in "public", one "table|count" line each.
$countSql = @"
SELECT c.relname || '|' ||
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;
"@

# SQL goes in files in a mounted folder, and no sh -c string below contains a
# double quote: Windows PowerShell 5.1 mangles embedded quotes in native
# arguments. set -f stops sh from globbing the unquoted URL (it may hold a ?).
$work = Join-Path ([IO.Path]::GetTempPath()) "carabao-backup-$PID"
New-Item -ItemType Directory -Force $work | Out-Null
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $work "count.sql"), $countSql.Replace("`r`n", "`n"), $utf8)
[IO.File]::WriteAllText((Join-Path $work "version.sql"), "SELECT version();`n", $utf8)
# The RLS policies (guards.sql) name these roles, and --no-acl does not skip
# CREATE POLICY ... TO <role>. Make them in the scratch server only.
$rolesSql = "CREATE ROLE carabao_owner NOLOGIN;`nCREATE ROLE carabao_api NOLOGIN;`n" +
  "CREATE ROLE carabao_web_public NOLOGIN;`nCREATE ROLE carabao_web_admin NOLOGIN;`n"
[IO.File]::WriteAllText((Join-Path $work "roles.sql"), $rolesSql, $utf8)

$env:PGURL = $url
$scratch = "carabao-backup-check-$PID"
$ok = $false
try {
  Invoke-Native "Connecting" {
    docker run --rm -e PGURL -v "${work}:/work:ro" $Image `
      sh -c 'set -f; exec psql --dbname=$PGURL -XAt -v ON_ERROR_STOP=1 -f /work/version.sql'
  }

  Write-Host "Dumping to $dumpPath ..."
  Invoke-Native "pg_dump" {
    docker run --rm -e PGURL -v "${OutDir}:/backup" $Image `
      sh -c "set -f; exec pg_dump --dbname=`$PGURL --format=custom --compress=6 --file=/backup/$name"
  }
  $sourceCounts = docker run --rm -e PGURL -v "${work}:/work:ro" $Image `
    sh -c 'set -f; exec psql --dbname=$PGURL -XAt -v ON_ERROR_STOP=1 -f /work/count.sql'
  if ($LASTEXITCODE -ne 0) { throw "Counting source rows failed." }

  Write-Host "Restoring into a throwaway container ..."
  Invoke-Native "Starting scratch Postgres" {
    docker run -d --name $scratch -e POSTGRES_PASSWORD=scratch `
      -v "${OutDir}:/backup:ro" -v "${work}:/work:ro" $Image | Out-Null
  }
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    # TCP, not the socket: the image's first-boot server listens on the
    # socket only, so this waits for the real server.
    docker exec $scratch pg_isready -h 127.0.0.1 -U postgres -q 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Scratch Postgres did not start." }

  # Owners and grants are skipped (--no-owner, --no-acl), so the restore is
  # about the data. The policies still need their roles (roles.sql above).
  # --exit-on-error makes any other problem fatal.
  Invoke-Native "Creating scratch roles" {
    docker exec $scratch psql -U postgres -d postgres -XAq -v ON_ERROR_STOP=1 -f /work/roles.sql
  }
  Invoke-Native "pg_restore" {
    docker exec $scratch pg_restore -U postgres -d postgres --no-owner --no-acl --exit-on-error "/backup/$name"
  }
  $restoredCounts = docker exec $scratch psql -U postgres -d postgres -XAt -v ON_ERROR_STOP=1 -f /work/count.sql
  if ($LASTEXITCODE -ne 0) { throw "Counting restored rows failed." }

  $diff = Compare-Object @($sourceCounts) @($restoredCounts)
  Write-Host ""
  Write-Host ("{0,-40} {1,10}" -f "table", "rows")
  foreach ($line in $sourceCounts) {
    $t, $n = $line -split '\|'
    Write-Host ("{0,-40} {1,10}" -f $t, $n)
  }
  Write-Host ""
  if ($diff) {
    $diff | Format-Table -AutoSize | Out-String | Write-Host
    throw "Row counts differ between the source and the restore. Do not rely on this backup."
  }

  $hash = (Get-FileHash $dumpPath -Algorithm SHA256).Hash.ToLower()
  $size = "{0:N0}" -f (Get-Item $dumpPath).Length
  Write-Host "OK: $(@($sourceCounts).Count) tables, every row count matches the restore."
  Write-Host "File:   $dumpPath ($size bytes)"
  Write-Host "SHA256: $hash"
  $ok = $true
}
finally {
  # A failed run must not leave a file that looks like a backup.
  if (-not $ok -and (Test-Path $dumpPath)) {
    Remove-Item -Force $dumpPath -ErrorAction SilentlyContinue
    Write-Host "Removed the incomplete dump $dumpPath."
  }
  Remove-Item Env:PGURL -ErrorAction SilentlyContinue
  docker rm -f $scratch 2>$null | Out-Null
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
