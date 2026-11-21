# Plan: one database login per service

Status: **draft, not started.** Written 2026-11-21.

## Why

web, web-admin and the API all connect to the same Postgres database with the same full-access login. If the public web server is compromised, an attacker can:

- set `role = 'admin'` on any account;
- write keys into `jwks_admin` (now blocked by `ADMIN_JWKS_THUMBPRINTS`, but only in the API);
- reset an admin's password, TOTP or 2FA flag, or plant a setup or reset token for an admin;
- read every business table: orders, payouts, encrypted tax IDs.

The fix is one Postgres login per service, plus guards inside the database. It stays **one database**. The API reads identity and admin role from Better Auth's `user` table and joins it to business data, so two databases would mean a rewrite.

**What this does not fix.** The public deploy signs tokens for every non-admin user, so if it is compromised, the attacker can still act as any buyer or merchant. Nothing short of moving sign-in elsewhere changes that. This plan keeps that compromise from reaching admin accounts or the business tables.

## 1. Logins

| Login | Used by | Notes |
|---|---|---|
| `carabao_owner` | migrations only (`auth:migrate:apply`, `alembic upgrade`, `create_tables.py`, the role SQL) | Owns every table. `NOLOGIN` except during a migration, or a password only you hold. |
| `carabao_api` | API, `make_admin.py` and the other backend scripts | Business tables plus the auth writes in `better_auth_store.py` |
| `carabao_web_public` | web (carabao. and merchant.) | Better Auth tables + `jwks` only |
| `carabao_web_admin` | web-admin | Better Auth tables + `jwks_admin` only |

None of the four is a superuser or a member of another, and none has `CREATE` on schema `public`. Only the table owner can drop or turn off a trigger or row-level security, so the web logins cannot remove the guards.

## 2. Access per table

S/I/U/D = SELECT / INSERT / UPDATE / DELETE. "Guarded" means a guard in section 3 narrows it.

| Table | web_public | web_admin | api |
|---|---|---|---|
| `user` | SIUD, guarded | SIUD, guarded | S, U (role, ban fields, image, updatedAt), I (make_admin `--create`), D |
| `session` | SIUD, guarded | SIUD | S, D |
| `account` | SIUD, guarded | SIUD | S, I, U (make_admin `--create`) |
| `verification` | SIUD, guarded | SIUD, guarded | S, I, D (2FA setup tokens) |
| `twoFactor` | S (to confirm: may need none) | SIUD | S, D (2FA reset) |
| `rateLimit` | SIUD | SIUD | none |
| `jwks` | S, I | **none** | none |
| `jwks_admin` | **none** | S, I | none |
| business tables, `alembic_version` | **none** | **none** | SIUD (+ sequence USAGE) |

The API's column list comes from reading [better_auth_store.py](../../backend/app/services/better_auth_store.py). Confirm it in the integration test (section 6), not by hand.

## 3. Guards

All guards run as functions owned by `carabao_owner` (`SECURITY DEFINER`, `search_path` fixed). Each one lets through `carabao_api`, `carabao_owner` and superusers. The superuser exception is what makes rollback work: if a service is pointed back at the old login, nothing breaks.

**G1. Role and ban fields belong to the API.** A `BEFORE INSERT OR UPDATE` trigger on `"user"`:
- On an insert from a web login, `role` must be NULL or `'user'`, and `banned` must be false or NULL.
- On an update from a web login, `role`, `banned`, `banReason` and `banExpires` must not change.

This closes promoting yourself and signing up as an admin.

**G2. The public login cannot touch admin accounts.** Row-level security for `carabao_web_public`, through a helper `is_admin(user_id)`:
- `user`: every row readable, so email uniqueness and sign-in lookups work. UPDATE and DELETE only where `role IS DISTINCT FROM 'admin'`.
- `account`, `session`, `twoFactor`: rows of admins are invisible and unwritable. An admin's password hash is never visible to the public deploy.

This closes changing an admin's password, wiping their TOTP and turning off their 2FA flag.

**G3. No tokens for admins from the public login.** RLS on `verification` for `carabao_web_public`:
- Refuse identifiers starting `admin-2fa-enrol-` (setup tokens come only from the API).
- Refuse a password-reset row whose user is an admin. **To check:** the exact identifier and value format Better Auth 1.7.26 uses for reset tokens.

For `carabao_web_admin`: refuse `admin-2fa-enrol-` inserts too, but allow reading and deleting them, since the admin site consumes them.

**G4 (optional, later). The admin login cannot touch non-admin accounts.** This is the same rule the other way round. It matters less, because web-admin is behind Cloudflare Access and has a much smaller attack surface.

## 4. Code changes

**`lib/auth.ts` (about 20–30 lines, ship first).** Today the public deploy refuses an admin by creating the session and then deleting it (`noAdminsOnPublicSurface`). Under G2 that insert fails with a database error, which would show an error page. So:
- Refuse in `databaseHooks.session.create.before` and `databaseHooks.account.create.before` when the user is an admin. Throw the same `ADMIN_ACCOUNT` APIError. For GET requests (OAuth callbacks), keep the redirect to `/auth?error=admin_account`. **To check:** that a redirect thrown from a database hook reaches the browser during an OAuth callback.
- Keep the after-hook as a second check.

This change works with today's single login too, so it can go out before any database change.

**Behaviour changes to expect (no security impact):**
- An admin's password sign-in on the public site says "invalid email or password", because the password row is hidden.
- An admin with an old Google link from before promotion may get an error page on the public Google sign-in, not the friendly message. Check this in testing.

**API:** no code change, only a new `DATABASE_URL`.

**Migrations:** no code change. Run them with `DATABASE_URL` set to the owner login (Alembic reads `DATABASE_URL` in `backend/alembic/env.py`).

## 5. New files

- `backend/db/roles.sql`: create the logins (idempotent), take ownership, grants, default privileges. Passwords are not in the file; pass them as psql variables.
- `backend/db/guards.sql`: the G1–G3 functions, triggers and policies (idempotent: `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
- `backend/tests_pg/test_db_roles.py`: the Postgres integration test (section 6).
- SUBDOMAINS.md: a new "Database logins" section and the deploy steps below. LOCAL_DATABASE.md: how to run the integration test.

Default privileges: `ALTER DEFAULT PRIVILEGES FOR ROLE carabao_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carabao_api` (and USAGE on sequences). A new Alembic table then reaches the API on its own. The web logins get **no** default privileges: a new Better Auth table stays closed until `guards.sql` grants it. That fails closed and loudly, as a sign-in error.

## 6. Tests

The backend tests run on SQLite and cannot see roles or RLS. Add an opt-in Postgres test that runs only when `PG_TEST_URL` is set. Run it locally (Docker `postgres:17`, the same as LOCAL_DATABASE.md) and before every deploy that touches auth tables.

It applies `auth:migrate:apply`, `alembic upgrade head`, `roles.sql` and `guards.sql` to an empty database, then checks the following.

**Must fail as `carabao_web_public`:** promote self; insert a user with `role='admin'`; unban self; read or write `jwks_admin`; read an admin's `account` row; update an admin's password; delete or overwrite an admin's `twoFactor` row; set `twoFactorEnabled=false` on an admin; insert an `admin-2fa-enrol-` token; insert a reset token for an admin; read `payout_batches`, `orders` or `merchant_applications`; `ALTER TABLE ... DISABLE TRIGGER`; `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`; `CREATE TABLE`.

**Must fail as `carabao_web_admin`:** read or write `jwks`; read business tables; change a role.

**Must work:** buyer sign-up, sign-in, session refresh and password reset (public); admin sign-in, TOTP enrolment through the setup token, and first-key creation in `jwks_admin` (admin); API promote, demote, ban, unban, 2FA reset, avatar change and account delete; `make_admin.py --create`.

The end-to-end web flows (Better Auth against the role logins) are a manual checklist run on a staging copy. Extend SUBDOMAINS.md section 6 with them.

## 7. Rollout on Railway

0. **Check first:** that Railway's Postgres user can `CREATE ROLE`, `ALTER TABLE ... OWNER` and create `SECURITY DEFINER` functions, and which Postgres major version it runs. If it can't, stop and rethink.
1. Ship the `lib/auth.ts` change (section 4) and confirm the admin-refused message still works.
2. Rehearse on a Railway fork of the database: run steps 4–7 there against copies of the services.
3. Back up the production database.
4. As the superuser, run `roles.sql`, then `guards.sql`. Nothing uses the new logins yet, so nothing changes.
5. Switch the API's `DATABASE_URL` to `carabao_api` and restart. Smoke-test the admin actions.
6. Switch web-admin to `carabao_web_admin`. Test admin sign-in, 2FA and API calls.
7. Switch web to `carabao_web_public`. Test buyer sign-up, sign-in, reset, Google sign-in and the admin-refused message.
8. Set the owner login to `NOLOGIN`, or keep its URL out of every service.

**Rollback** for any step: point that service's `DATABASE_URL` back at the old login and restart. The guards let the superuser through, so the old setup works with them in place.

**From then on:** run every migration as the owner, and re-run `guards.sql` after any `auth:migrate:apply`. Put both in the SUBDOMAINS.md deploy steps.

## 8. Decisions for you

1. Do G4 (restrict web-admin to admin rows) now or later? I recommend later.
2. Should local dev keep one full-access login (simplest, and the integration test covers the roles) or use the role logins too? I recommend keeping one login locally.
3. When to rehearse on a Railway fork. It needs a little database time and copies of three services.

**Effort:** about 1–2 days of work plus the rehearsal. Most of it is the guard SQL and its test, not app code.
