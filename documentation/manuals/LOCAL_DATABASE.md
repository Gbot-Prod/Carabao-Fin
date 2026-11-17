# Local Postgres Database (Docker)

This guide sets up a local Postgres database for Carabao on Windows with Docker. Both apps use it: the web app (Better Auth tables) and the API (all other tables).

Tested on 2026-11-17 on an empty database: Windows 10 Home, Docker Desktop, `postgres:17`.

See also: [SYSTEM_REFERENCE.md](SYSTEM_REFERENCE.md) section 5 (local development) and section 4.4 (Postgres TLS).

---

## 1. Summary

```powershell
# 1. Database container (one time)
docker run -d --name carabao-pg -e POSTGRES_USER=carabao -e POSTGRES_PASSWORD=carabao -e POSTGRES_DB=carabao -p 5432:5432 -v carabao-pgdata:/var/lib/postgresql/data postgres:17
docker update --restart unless-stopped carabao-pg

# 2. DATABASE_URL in backend/.env and frontend/carabao-app/.env.local
#    postgresql://carabao:carabao@localhost:5432/carabao

# 3. Better Auth tables FIRST
cd frontend/carabao-app
npm run auth:migrate:apply

# 4. API tables (NOT "alembic upgrade head" on an empty database)
cd ../../backend
uv run python scripts/create_tables.py
uv run alembic stamp head
```

The sections below give the details and the known problems.

---

## 2. Why Docker

- Postgres stays in one container. It does not install a Windows service, a superuser or a program folder.
- To start again with an empty database, remove the container and the volume (section 9).
- One command sets the user, the password, the database and the version.
- `postgres:17` gives the same major version each time. Keep it the same as the Railway Postgres major version.

Use the Windows installer if Docker Desktop is not available. Docker Desktop on Windows 10 Home needs WSL 2.

---

## 3. Prerequisites

1. Install Docker Desktop.
2. Make sure that WSL 2 is installed and up to date:
   ```powershell
   wsl --status
   wsl --update
   ```
   If WSL is not installed, run `wsl --install` in an administrator PowerShell, then restart the computer.
3. Start Docker Desktop. Wait until it shows **"Engine running"**.
4. Make sure that the engine is ready:
   ```powershell
   docker info
   ```
5. In Docker Desktop, go to **Settings > General** and turn on **"Start Docker Desktop when you sign in"**.

### Make sure that port 5432 is free

A Windows Postgres service can also use port 5432. If it does, `localhost:5432` connects to it and not to Docker.

```powershell
Get-Service *postgres*
netstat -ano | findstr ":5432 " | findstr LISTEN
```

If a `postgresql-x64-NN` service runs, stop it and keep it stopped (administrator PowerShell, one time):

```powershell
Stop-Service postgresql-x64-18
Set-Service postgresql-x64-18 -StartupType Manual
```

To use it again later: `Start-Service postgresql-x64-18`.

If you must keep the Windows service, map Docker to a different port (`-p 5433:5432`) and use port `5433` in `DATABASE_URL`.

---

## 4. Make the container

```powershell
docker run -d --name carabao-pg `
  -e POSTGRES_USER=carabao `
  -e POSTGRES_PASSWORD=carabao `
  -e POSTGRES_DB=carabao `
  -p 5432:5432 `
  -v carabao-pgdata:/var/lib/postgresql/data `
  postgres:17

docker update --restart unless-stopped carabao-pg
```

- The `carabao-pgdata` volume keeps the data when you remove the container.
- `--restart unless-stopped` starts the container each time Docker Desktop starts.
- `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` have an effect only when the volume is empty. If you change them later, remove the volume first (section 9).

These credentials are for local development only. Do not use them on a server.

---

## 5. Set the database URL

Put the same URL in both files:

| File | Value |
|---|---|
| `backend/.env` | `DATABASE_URL=postgresql://carabao:carabao@localhost:5432/carabao` |
| `frontend/carabao-app/.env.local` | `DATABASE_URL=postgresql://carabao:carabao@localhost:5432/carabao` |

Leave `PGSSL_CA` and `PGSSL_SERVERNAME` empty. For `localhost`, `127.0.0.1` and `::1`, both apps connect without TLS and do not read these values (`frontend/carabao-app/lib/db-ssl.mjs`, `backend/app/core/database_url.py`).

**Caution:** The web app reads `POSTGRES_URL` before `DATABASE_URL` (SYSTEM_REFERENCE.md 4.2). If `.env.local` has `POSTGRES_URL`, `POSTGRESQL_URL` or `PGDATABASE_URL`, remove it or set it to the local URL. If you do not, the web app continues to use the other database.

### Keep the production values as comments

You need the Railway values again to connect a local app to production. Do not delete them:

```
# Local
DATABASE_URL=postgresql://carabao:carabao@localhost:5432/carabao
PGSSL_CA=
PGSSL_SERVERNAME=

# Railway (production). Remove the "#" to use it.
# DATABASE_URL=postgresql://...
# PGSSL_CA="-----BEGIN CERTIFICATE-----\n..."
# PGSSL_SERVERNAME=localhost
```

The deployed apps do not read these files. Railway has its own variables.

---

## 6. Make the tables

The order is important. API migration `d3f7b1e9a5c2` adds foreign keys to the Better Auth `"user"` table, so the Better Auth tables must exist first.

### 6.1 Better Auth tables (web app)

```powershell
cd frontend/carabao-app
npm run auth:migrate            # shows the SQL only
npm run auth:migrate:apply
```

The script has two passes:

| Pass | Makes |
|---|---|
| `public` | `user`, `session`, `account`, `verification`, `twoFactor`, `jwks` |
| `admin JWT keys (jwks_admin)` | `jwks_admin` |

Make sure that the dry run shows `create table "jwks"`. If it does not, see problem 10.4.

### 6.2 API tables (backend)

**Do not run `alembic upgrade head` on an empty database.** The first revision (`db7e5a6a9813`) changes `backend_users`, but no revision makes that table. The Alembic history starts from tables that already existed. See problem 10.5.

Make the tables from the current models, then mark the database as up to date:

```powershell
cd backend
uv run python scripts/create_tables.py     # "Created/verified N tables."
uv run alembic stamp head
uv run alembic current                     # must show "(head)"
```

- `create_tables.py` only makes tables that do not exist. You can run it again safely.
- `alembic stamp head` does not run migrations. It only records the newest revision. After this, `uv run alembic upgrade head` applies only new revisions.

**Known difference:** `create_all` makes the schema from the SQLAlchemy models. If a revision added a constraint or an index that the models do not declare, the local database does not have it. For example, check `b8e4f2a6c1d3_status_check_constraints`. This is usually not a problem for local development. Do not use this database to test a migration that depends on such a constraint.

---

## 7. Make sure that it works

### 7.1 Tables

```powershell
docker exec carabao-pg psql -U carabao -d carabao -c '\dt'
```

Expected: 33 tables, which include `user`, `session`, `account`, `verification`, `twoFactor`, `jwks`, `jwks_admin`, `alembic_version`, `backend_users` and the other API tables.

### 7.2 Apps

1. Start the API: `cd backend && uv run uvicorn main:app --reload --port 8000`.
2. Start the web app: `cd frontend/carabao-app && npm run dev`.
3. The web app log must show `[auth] Better Auth DB target host=localhost db=carabao`. If the host is not `localhost`, the web app uses a different database. Do section 5 again.
4. Sign up with a mobile number.
5. In the browser developer tools, make sure that `/api/auth/token` returns 200 and that API calls (for example `/carts/me`) do not return 401.

### 7.3 Data after sign-up

```powershell
docker exec carabao-pg psql -U carabao -d carabao -c 'SELECT id, "phoneNumber", "phoneNumberVerified", role FROM "user";'
docker exec carabao-pg psql -U carabao -d carabao -c 'SELECT count(*) FROM session;'
docker exec carabao-pg psql -U carabao -d carabao -c 'SELECT id, "createdAt" FROM jwks;'
docker exec carabao-pg psql -U carabao -d carabao -c 'SELECT * FROM backend_users;'
```

Expected:

- `user`: one row, `phoneNumberVerified = t`.
- `session`: one or more rows.
- `jwks`: one row after the first token request.
- `backend_users`: one row after the first authenticated API call. The row does not exist directly after sign-up.

---

## 8. Look at the data

### 8.1 psql in the container

Open an interactive prompt:

```powershell
docker exec -it carabao-pg psql -U carabao -d carabao
```

| Command | What it does |
|---|---|
| `\dt` | Lists all tables |
| `\d "user"` | Shows the columns of a table |
| `SELECT id, "phoneNumber", role FROM "user";` | Shows the users |
| `\x` | Toggles the expanded display (for wide rows) |
| `\q` | Exits |

Put double quotes around `user` (a reserved word) and around camelCase columns such as `"phoneNumber"` and `"createdAt"`.

To run one query without the prompt:

```powershell
docker exec carabao-pg psql -U carabao -d carabao -c 'SELECT * FROM session;'
```

### 8.2 GUI

Connect DBeaver, pgAdmin or a VS Code PostgreSQL extension with these values:

| Setting | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `carabao` |
| User | `carabao` |
| Password | `carabao` |
| SSL | off |

---

## 9. Daily use and reset

| Task | Command |
|---|---|
| Start | `docker start carabao-pg` (automatic with `--restart unless-stopped`) |
| Stop | `docker stop carabao-pg` |
| Status | `docker ps -a --filter name=carabao-pg` |
| Logs | `docker logs carabao-pg` |
| Back up | `docker exec carabao-pg pg_dump -U carabao carabao > carabao-local.sql` |
| Restore | `Get-Content carabao-local.sql \| docker exec -i carabao-pg psql -U carabao -d carabao` |

### Start again with an empty database

**Caution:** These commands delete all local data. Back up first if you need it.

```powershell
docker rm -f carabao-pg
docker volume rm carabao-pgdata
```

Then do sections 4 and 6 again.

---

## 10. Problems found during setup (2026-11-17)

### 10.1 `docker: error during connect ... dockerDesktopLinuxEngine`

```
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

**Cause:** The Docker engine does not run. The terminal (for example the VS Code terminal) is not the cause.

**Fix:** Start Docker Desktop and wait for "Engine running". Run `docker info` to make sure. If Docker Desktop does not start, see section 3 (WSL 2, virtualization in the BIOS).

### 10.2 `password authentication failed for user "carabao"` (code 28P01)

**Cause:** A Windows Postgres service (`postgresql-x64-18`) also listened on port 5432. The connection to `localhost:5432` went to that server, which has no `carabao` user.

**Find it:** `netstat -ano | findstr ":5432 " | findstr LISTEN` shows two process IDs. `Get-Process -Id <pid>` shows `postgres` and `com.docker.backend`.

**Fix:** Stop the service and set it to Manual (section 3), or map Docker to port 5433.

Other causes of the same error:

- The volume was made earlier with a different password. `POSTGRES_PASSWORD` has an effect only on an empty volume. Remove the volume (section 9).
- The password in `DATABASE_URL` is not the same as `POSTGRES_PASSWORD`.

### 10.3 `PGSSL_CA` / `PGSSL_SERVERNAME` with a local database

They are not necessary. Leave them empty (section 5).

### 10.4 `/api/auth/token` returns 500, API calls return 401

**Symptom:** After sign-up, the browser shows:

```
GET /api/auth/token        500 (Internal Server Error)
GET :8000/carts/me         401 (Unauthorized)
GET :8000/users/me/follows 401 (Unauthorized)
```

The `jwks` table does not exist. Only `jwks_admin` exists. `npm run auth:migrate` says "Better Auth schema is already up to date".

**Cause:** A bug in `frontend/carabao-app/scripts/better-auth-migrate.mjs` (fixed on 2026-11-17).

Better Auth's `mergeSchema` (`node_modules/better-auth/dist/db/schema.mjs`) changes the schema object that it receives. The jwt plugin gives it its module-level `schema` object, so all `jwt()` instances in one process share it. A call to `jwt({ schema: { jwks: { modelName: "jwks_admin" } } })` renames the model for every `jwt()` instance, including those made before.

The script made the admin config when the file loaded, before the `public` pass ran. Thus both passes used `jwks_admin`, and the script never made `jwks`. Without `jwks`, Better Auth cannot sign a token. Without a token, the API returns 401.

**Fix in the script:** The admin config is now a function. The script calls it only after the `public` pass is complete:

```js
const adminJwksConfig = () => ({
  ...config,
  plugins: [jwt({ schema: { jwks: { modelName: "jwks_admin" } } })],
});

for (const [name, makeCfg] of [
  ["public", () => config],
  ["admin JWT keys (jwks_admin)", adminJwksConfig],
]) {
  const migrations = await getMigrations(makeCfg());
  ...
}
```

**Repair an existing database:** Pull the fixed script, then:

```powershell
cd frontend/carabao-app
npm run auth:migrate            # must show: create table "jwks" ...
npm run auth:migrate:apply
```

**Production:** The deployed web app runs one `jwt()` per process (`lib/auth.ts`, public or admin surface), so the running app is not affected. Only the migrate script was affected. The Railway database probably already had `jwks` before the admin pass was added to the script. Run the dry run against production to make sure.

**Rule:** In one Node process, do not make more than one `jwt()` plugin with different `modelName` values if one of them is used later. Make each config only when it is needed.

### 10.5 `alembic upgrade head`: `relation "backend_users" does not exist`

```
Running upgrade  -> db7e5a6a9813, user and merchant data consistencies ...
psycopg.errors.UndefinedTable: relation "backend_users" does not exist
```

**Cause:** The Alembic history does not start from an empty database. The first revision changes tables that existed before Alembic was added.

**Effect:** None. Alembic uses transactional DDL, so it rolled back the failed revision.

**Fix:** Use `create_tables.py` and `alembic stamp head` (section 6.2).

### 10.6 `create_tables.py`: `column "email" does not exist`

```
CREATE UNIQUE INDEX IF NOT EXISTS ix_backend_users_email_lower ON backend_users (lower(email))
psycopg.errors.UndefinedColumn: column "email" does not exist
```

**Cause:** `backend/scripts/create_tables.py` made the index `ix_backend_users_email_lower` after `create_all`. Revision `c3e8a1f5d7b9_identity_only_in_better_auth` removed `email` from `backend_users`, because the email is now in the Better Auth `"user"` table. The script was not updated after that change.

**Effect:** `create_all` was already complete when the error occurred, so the tables existed.

**Fix (2026-11-17):** The index step and its `text` import were removed from the script. Run the script again, then `alembic stamp head`.

### 10.7 Sign-up works, but no `backend_users` row is made

**Symptom:** The new user is in `"user"` in the local database, but `backend_users` stays empty. API calls return 401.

**How the row is made:** Sign-up does not make the row. The API makes it on the first request with a valid token (`backend/app/services/auth_identity.py`, `resolve_user`). First, the API looks for the token subject in the Better Auth `"user"` table of ITS database. If the subject is not there, it returns 401 "This account no longer exists" and makes no row.

**Cause:** The API was started before `DATABASE_URL` in `backend/.env` was changed. `uvicorn --reload` restarts only when a `.py` file changes. It does not restart when `.env` changes, so the API still used the old database (Railway). The Next.js dev server reloads `.env.local` automatically, so the web app used the new local database. The user was in one database, and the API looked in a different one.

**Find it:** Compare the start time of the uvicorn worker (`Get-CimInstance Win32_Process`, child of the `uvicorn.exe` process) with the change time of `backend/.env`. If the worker is older, it uses the old values.

**Fix:** Stop the API (Ctrl+C) and start it again. Then reload the page while signed in. You do not need to sign up again.

**Rule:** After each change to `backend/.env`, restart the API manually.
