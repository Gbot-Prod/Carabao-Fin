<#
.SYNOPSIS
  Apply roles.sql and guards.sql to a Postgres database and prove the result.

.DESCRIPTION
  DB_ROLE_SPLIT_PLAN.md section 8, step 5. Needs Docker; uses the postgres:17
  image, so no local psql is required.

  1. Checks the connection: Postgres 17, connected as a superuser. Prints the
     host, database, the current state (who owns "public", RLS, policies,
     which carabao_* logins exist) and the row count of every table.
  2. Asks you to type the database name before changing anything.
  3. Runs roles.sql, then guards.sql (each is one transaction, so a failure
     changes nothing), with ON_ERROR_STOP.
  4. Checks the end state (ownership, login attributes, memberships, CREATE on
     public, RLS, the 20 policies, the trigger, the guard functions, which
     tables each web login can reach) and that every row count is unchanged.
  5. With -SetPasswords: opens psql's \password prompt for carabao_api,
     carabao_web_public and carabao_web_admin, then checks that each now has a
     password. \password hashes it in psql, so it never appears on a command
     line, in the shell history or in the server log.

  Safe to run again: both SQL files are idempotent, and a second run on an
  already-split database must pass the same checks.

  The URL is asked for at a hidden prompt (or read from $env:APPLY_DATABASE_URL)
  and only ever reaches the containers as an environment variable, never as a
  command-line argument. Use the superuser's public URL: Railway > Postgres >
  Variables > DATABASE_PUBLIC_URL.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\db\apply_roles.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\db\apply_roles.ps1 -SetPasswords
#>
param(
  [switch]$SetPasswords,
  # Skips the typed confirmation when it equals the database name (for tests).
  [string]$ConfirmDatabase = "",
  [string]$Image = "postgres:17"
)

# Not "Stop": Windows PowerShell 5.1 turns any stderr line from a native
# command into a terminating error. Failures are caught by exit code instead.
$ErrorActionPreference = "Continue"

$sqlDir = $PSScriptRoot
foreach ($f in "roles.sql", "guards.sql") {
  if (-not (Test-Path (Join-Path $sqlDir $f))) { throw "$f not found next to this script." }
}

$url = $env:APPLY_DATABASE_URL
if (-not $url) {
  $secure = Read-Host "Superuser DATABASE_PUBLIC_URL" -AsSecureString
  $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($url -notmatch '^postgres(ql)?://') { throw "That does not look like a postgres:// URL." }
$target = [uri]($url -replace '^postgres(ql)?://', 'http://')
$targetHost = "$($target.Host):$($target.Port)"

# ── SQL ─────────────────────────────────────────────────────────────────────

# Exact row count per table in "public", one "table|count" line each.
$countSql = @"
SELECT c.relname || '|' ||
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;
"@

# "key|value" lines describing the connection and the current state.
$preflightSql = @"
SELECT 'server|' || current_setting('server_version');
SELECT 'major|' || current_setting('server_version_num')::int / 10000;
SELECT 'database|' || current_database();
SELECT 'user|' || current_user;
SELECT 'superuser|' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
SELECT 'owners|' || COALESCE(string_agg(o || ' ' || n, ', ' ORDER BY o), 'none')
FROM (SELECT pg_get_userbyid(c.relowner) AS o, count(*) AS n
      FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = 'public' GROUP BY 1) x;
SELECT 'logins|' || COALESCE(string_agg(rolname, ', ' ORDER BY rolname), 'none')
FROM pg_roles WHERE rolname LIKE 'carabao\_%';
SELECT 'rls_tables|' || count(*)
FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
WHERE s.nspname = 'public' AND c.relrowsecurity;
SELECT 'policies|' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT 'triggers|' || count(*)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace s ON s.oid = c.relnamespace
WHERE s.nspname = 'public' AND NOT t.tgisinternal;
SELECT 'auth_tables|' || count(*)
FROM unnest(ARRAY['user', 'session', 'account', 'verification', 'twoFactor',
                  'rateLimit', 'jwks', 'jwks_admin']) t
WHERE to_regclass(format('public.%I', t)) IS NOT NULL;
"@

# One "check|t or f|detail" line per end-state check (plan sections 1, 3, 4).
$postcheckSql = @"
WITH
logins(r) AS (VALUES ('carabao_owner'), ('carabao_api'), ('carabao_web_public'), ('carabao_web_admin')),
auth(t) AS (VALUES ('user'), ('session'), ('account'), ('verification'), ('twoFactor'),
                   ('rateLimit'), ('jwks'), ('jwks_admin')),
guarded(t) AS (VALUES ('user'), ('session'), ('account'), ('verification'), ('twoFactor')),
not_owned AS (
  SELECT c.relname AS obj FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND pg_get_userbyid(c.relowner) <> 'carabao_owner'
  UNION ALL
  SELECT t.typname FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace
  WHERE s.nspname = 'public' AND t.typtype IN ('e', 'd')
    AND pg_get_userbyid(t.typowner) <> 'carabao_owner'
  UNION ALL
  SELECT p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
  WHERE s.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'carabao_owner'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                    AND d.objid = p.oid AND d.deptype = 'e')
),
business AS (
  SELECT c.relname AS t FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND c.relname NOT IN (SELECT t FROM auth)
),
web_reach AS (
  SELECT r || ' on ' || b.t AS what
  FROM business b CROSS JOIN (VALUES ('carabao_web_public'), ('carabao_web_admin')) w(r)
  WHERE has_table_privilege(r, format('public.%I', b.t), 'SELECT, INSERT, UPDATE, DELETE')
),
checks(name, ok, detail) AS (
  SELECT 'all four logins exist',
         (SELECT count(*) FROM pg_roles WHERE rolname IN (SELECT r FROM logins)) = 4,
         (SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles WHERE rolname IN (SELECT r FROM logins))
  UNION ALL
  SELECT 'no login is superuser, BYPASSRLS, CREATEROLE or CREATEDB',
         NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (SELECT r FROM logins)
                     AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)),
         ''
  UNION ALL
  SELECT 'carabao_owner is NOLOGIN',
         NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'carabao_owner'), ''
  UNION ALL
  SELECT 'no login is a member of any role',
         NOT EXISTS (SELECT 1 FROM pg_auth_members am JOIN pg_roles u ON u.oid = am.member
                     WHERE u.rolname IN (SELECT r FROM logins)),
         ''
  UNION ALL
  SELECT 'everything in public is owned by carabao_owner',
         NOT EXISTS (SELECT 1 FROM not_owned),
         COALESCE((SELECT string_agg(obj, ', ') FROM (SELECT obj FROM not_owned LIMIT 10) x), '')
  UNION ALL
  SELECT 'only carabao_owner can CREATE in public',
         has_schema_privilege('carabao_owner', 'public', 'CREATE')
         AND NOT has_schema_privilege('carabao_api', 'public', 'CREATE')
         AND NOT has_schema_privilege('carabao_web_public', 'public', 'CREATE')
         AND NOT has_schema_privilege('carabao_web_admin', 'public', 'CREATE'),
         ''
  UNION ALL
  SELECT 'RLS on user, session, account, verification, twoFactor',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
          WHERE s.nspname = 'public' AND c.relname IN (SELECT t FROM guarded) AND c.relrowsecurity) = 5,
         ''
  UNION ALL
  SELECT '20 policies on the guarded tables',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
          AND tablename IN (SELECT t FROM guarded)) = 20,
         (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'
          AND tablename IN (SELECT t FROM guarded)) || ' found'
  UNION ALL
  SELECT 'trigger guard_user_write on "user", enabled',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_user_write'
                 AND tgrelid = 'public."user"'::regclass AND tgenabled = 'O'),
         ''
  UNION ALL
  SELECT 'is_admin, is_admin_phone SECURITY DEFINER; guard_user_write, public_may_use_verification not',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
          WHERE s.nspname = 'public'
            AND pg_get_userbyid(p.proowner) = 'carabao_owner'
            AND ((p.proname IN ('is_admin', 'is_admin_phone') AND p.prosecdef)
              OR (p.proname IN ('guard_user_write', 'public_may_use_verification') AND NOT p.prosecdef))) = 4,
         ''
  UNION ALL
  SELECT 'web logins reach no business or audit table',
         NOT EXISTS (SELECT 1 FROM web_reach),
         COALESCE((SELECT string_agg(what, ', ') FROM (SELECT what FROM web_reach LIMIT 10) x), '')
  UNION ALL
  SELECT 'jwks_admin closed to the public login, jwks closed to the admin login',
         NOT has_table_privilege('carabao_web_public', 'public.jwks_admin', 'SELECT, INSERT, UPDATE, DELETE')
         AND NOT has_table_privilege('carabao_web_admin', 'public.jwks', 'SELECT, INSERT, UPDATE, DELETE'),
         ''
  UNION ALL
  SELECT 'API cannot change "user".role',
         NOT has_column_privilege('carabao_api', 'public."user"', 'role', 'UPDATE'),
         ''
)
SELECT name || '|' || ok || '|' || COALESCE(detail, '') FROM checks;
"@

$passwordCheckSql = @"
SELECT rolname || '|' || (rolpassword IS NOT NULL)
FROM pg_authid
WHERE rolname IN ('carabao_api', 'carabao_web_public', 'carabao_web_admin')
ORDER BY rolname;
"@

# ── Helpers ─────────────────────────────────────────────────────────────────

function Invoke-Native {
  # Run a native command and stop on a non-zero exit code.
  param([string]$What, [scriptblock]$Cmd)
  & $Cmd
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function ConvertTo-Map {
  param($Lines)
  $map = [ordered]@{}
  foreach ($line in @($Lines)) {
    $k, $v = $line -split '\|', 2
    $map[$k] = $v
  }
  return $map
}

# SQL goes in files in a mounted folder, and no sh -c string below contains a
# double quote: Windows PowerShell 5.1 mangles embedded quotes in native
# arguments. set -f stops sh from globbing the unquoted URL (it may hold a ?).
$work = Join-Path ([IO.Path]::GetTempPath()) "carabao-apply-$PID"
New-Item -ItemType Directory -Force $work | Out-Null
$utf8 = New-Object Text.UTF8Encoding $false
function Write-WorkFile([string]$Name, [string]$Text) {
  [IO.File]::WriteAllText((Join-Path $work $Name), $Text.Replace("`r`n", "`n"), $utf8)
}
Write-WorkFile "count.sql" $countSql
Write-WorkFile "preflight.sql" $preflightSql
Write-WorkFile "postcheck.sql" $postcheckSql
Write-WorkFile "pwcheck.sql" $passwordCheckSql
Write-WorkFile "passwords.sql" "\echo Set the password for carabao_api`n\password carabao_api`n\echo Set the password for carabao_web_public`n\password carabao_web_public`n\echo Set the password for carabao_web_admin`n\password carabao_web_admin`n"

function Invoke-Query([string]$File) {
  $out = docker run --rm -e PGURL -v "${work}:/work:ro" $Image `
    sh -c "set -f; exec psql --dbname=`$PGURL -XAt -v ON_ERROR_STOP=1 -f /work/$File"
  if ($LASTEXITCODE -ne 0) { throw "Query $File failed (exit code $LASTEXITCODE)." }
  return $out
}

$env:PGURL = $url
try {
  # ── 1. Preflight ──────────────────────────────────────────────────────────
  Write-Host "Connecting to $targetHost ..."
  $pre = ConvertTo-Map (Invoke-Query "preflight.sql")
  if ($pre["superuser"] -ne "true") { throw "Connected as $($pre['user']), which is not a superuser. Use the postgres login." }
  if ($pre["major"] -ne "17") { throw "Server is Postgres $($pre['server']); the plan was checked on 17." }
  if ($pre["auth_tables"] -ne "8") {
    Write-Warning "Only $($pre['auth_tables']) of the 8 Better Auth tables exist. roles.sql will skip the missing ones' grants."
  }
  $before = Invoke-Query "count.sql"

  Write-Host ""
  Write-Host "Target:          $targetHost / $($pre['database'])"
  Write-Host "Server:          Postgres $($pre['server']), as $($pre['user']) (superuser)"
  Write-Host "Owners (public): $($pre['owners'])"
  Write-Host "carabao logins:  $($pre['logins'])"
  Write-Host "RLS tables:      $($pre['rls_tables']); policies: $($pre['policies']); triggers: $($pre['triggers'])"
  Write-Host "Tables:          $(@($before).Count)"
  Write-Host ""

  # ── 2. Confirm ────────────────────────────────────────────────────────────
  if ($ConfirmDatabase -ne $pre["database"]) {
    $typed = Read-Host "Type the database name ($($pre['database'])) to apply roles.sql and guards.sql"
    if ($typed -ne $pre["database"]) { throw "Not confirmed. Nothing was changed." }
  }

  # ── 3. Apply ──────────────────────────────────────────────────────────────
  Write-Host "Applying roles.sql and guards.sql ..."
  $started = Get-Date
  Invoke-Native "roles.sql / guards.sql" {
    docker run --rm -e PGURL -v "${sqlDir}:/sql:ro" $Image `
      sh -c 'set -f; exec psql --dbname=$PGURL -X -q -v ON_ERROR_STOP=1 -f /sql/roles.sql -f /sql/guards.sql'
  }
  $seconds = "{0:N1}" -f ((Get-Date) - $started).TotalSeconds
  Write-Host "Applied in $seconds s."

  # ── 4. Check ──────────────────────────────────────────────────────────────
  Write-Host ""
  $failed = 0
  foreach ($line in @(Invoke-Query "postcheck.sql")) {
    $name, $ok, $detail = $line -split '\|', 3
    if ($ok -eq "t" -or $ok -eq "true") {
      Write-Host "  ok    $name"
    } else {
      $failed++
      Write-Host "  FAIL  $name  $detail" -ForegroundColor Red
    }
  }

  $after = Invoke-Query "count.sql"
  $diff = Compare-Object @($before) @($after)
  if ($diff) {
    $failed++
    Write-Host "  FAIL  row counts changed:" -ForegroundColor Red
    $diff | Format-Table -AutoSize | Out-String | Write-Host
  } else {
    Write-Host "  ok    row counts unchanged ($(@($after).Count) tables)"
  }
  if ($failed -gt 0) {
    throw "$failed check(s) failed. Services still use the postgres login, so nothing is broken; investigate before step 6."
  }

  # ── 5. Passwords (optional) ───────────────────────────────────────────────
  if ($SetPasswords) {
    Write-Host ""
    Write-Host "Setting passwords. Use a long random password for each, and keep them for step 6."
    # -it: \password reads from the terminal. The password is hashed in psql.
    Invoke-Native "\password" {
      docker run --rm -it -e PGURL -v "${work}:/work:ro" $Image `
        sh -c 'set -f; exec psql --dbname=$PGURL -X -q -v ON_ERROR_STOP=1 -f /work/passwords.sql'
    }
    $missing = @()
    foreach ($line in @(Invoke-Query "pwcheck.sql")) {
      $r, $has = $line -split '\|', 2
      if ($has -ne "t" -and $has -ne "true") { $missing += $r }
    }
    if ($missing) { throw "No password set for: $($missing -join ', ')." }
    Write-Host "  ok    carabao_api, carabao_web_public and carabao_web_admin have passwords"
  }

  Write-Host ""
  Write-Host "Step 5 done on $targetHost / $($pre['database']) at $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm')) UTC."
}
finally {
  Remove-Item Env:PGURL -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
