# Plan: one database login per service

Status: **complete (2026-11-22).** Written 2026-11-21, rewritten 2026-11-22. Step 0 passed 2026-11-22. Step 1 completed 2026-11-22. Step 2 code done 2026-11-22 (manual checklist pending). Step 3 rehearsed 2026-11-22 on a local restore of the production dump, because Railway forks failed to create: steps 5–8 all passed. Step 4: production logical dump taken and verified 2026-11-22; the Railway volume backup is still to do. Step 5 completed 2026-11-22 09:15 UTC on production (`backend/db/apply_roles.ps1`, all checks ok, service-login passwords set). Step 2 merged to `main` (#41). **Step 6 completed 2026-11-22: the API runs as `carabao_api`** (6a at 09:46 UTC; 6b, the admin-account smoke test, done and reviewed). **Steps 7 and 8 completed 2026-11-22:** web-admin runs as `carabao_web_admin` and web as `carabao_web_public`, both tested. **Step 9 completed 2026-11-22. The plan is complete.** Next: a wipe of the production data and a new round of account and admin tests ([Admin creation.md](Admin%20creation.md) section 9).

Decisions in section 9 are settled. Open checks were resolved from the Better Auth 1.7.26 source. Admin accounts move to invite-only with an out-of-band code (section 2), shipped before the database change (section 8, step 2). In-place migration chosen (section 8).

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
| `carabao_api` | API, `make_admin.py` and the other backend scripts | Business tables, every admin-account write (invite, invite acceptance, deactivate, reactivate, 2FA reset), plus the other auth writes in `better_auth_store.py` |
| `carabao_web_public` | web (carabao. and merchant.) | Better Auth tables + `jwks` only |
| `carabao_web_admin` | web-admin | Better Auth tables + `jwks_admin` only |

None of the four is a superuser or a member of another, and none has `CREATE` on schema `public`. Only the table owner can drop or turn off a trigger or row-level security, so the web logins cannot remove the guards.

Railway's built-in `postgres` superuser stays enabled (not `NOLOGIN`). It is the rollback and break-glass login: its URL lives only in the Railway Postgres service and with you, never in a web, web-admin or API service.

## 2. Admin accounts

This replaces promotion. Today an admin promotes an existing buyer account (`PATCH /admin/users/{id}/role`) or `make_admin.py <email>` promotes one. After this change, an admin account is only ever made as an admin account, and buyer and admin accounts never share an email.

### Rules

- **Separate accounts.** The public site refuses admin accounts (`noAdminsOnPublicSurface`, already in place). The admin site refuses non-admin accounts (`adminSurfaceOnly`, already in place). An invite to an email that already has any Carabao account is refused: "This email already has a Carabao account. Invite a different address."
- **No promotion.** `PATCH /admin/users/{id}/role` is removed, along with its button on the admin users page. `make_admin.py` loses its "promote an existing account" mode. It keeps `--create` and gains `--recover` (below).
- **Every admin-account write goes through the API** (`carabao_api`). web-admin pages call API endpoints. web-admin's own database login only does what Better Auth needs for sign-in, sign-out and TOTP setup. This is also what lets every step be audited, because only the API can write audit tables.
- **Admins cannot change themselves.** No self-deactivation and no self-reset of 2FA (today's rule).
- **Admin accounts cannot be deleted.** The account-delete endpoint refuses an admin target. Use deactivation instead.
- **The plain ban endpoints refuse admin targets.** Use deactivate and reactivate, which also handle 2FA and the last-admin rule.

### Invite (new admin)

Three things are needed to become an admin: the link (by email), the code (handed over by the inviting admin, in person or over a channel both trust), and an authenticator. Then the new admin signs in with all of them.

1. **Invite.** An admin (with an `mfa=true` session) enters the email and name on the admin users page. web-admin calls `POST /admin/invites`. The API, in one transaction:
   - refuses the invite if the email already belongs to any account;
   - inserts the `user` row: `role = 'admin'`, `emailVerified = false`, `twoFactorEnabled = false`, no `account` row (so no password yet);
   - creates the setup token: `verification` row `admin-2fa-enrol-<userId>`, value = SHA-256 of the token, expires in **24 hours** (the existing `admin_enrolment.issue`);
   - creates the out-of-band code: `verification` row `admin-invite-code-<userId>`, value `<SHA-256 of the code>:<failed attempts>` (starting at `0`), expires in **24 hours**. The code is 8 characters from an unambiguous alphabet (no `0/O`, `1/I/L`), shown as `XXXX-XXXX`;
   - writes the audit row `ADMIN_INVITE` (actor, invitee, time the code was issued);
   - emails the link `admin.<root>/admin/invite?invite=<userId>&token=<token>` to the invitee;
   - returns the code to the inviting admin. The admin UI shows it **once**, with "Give this code to the new admin yourself. Don't send it in the same email or chat as the link."

   The code is never stored in plain text, never emailed, and never shown again. If it is lost, use **Resend invite**.

2. **Accept.** The invitee opens the link. The `/admin/invite` page (no session needed) asks for the code and a new password (twice, 12+ characters). web-admin's route handler forwards the invite id, token, code and password to `POST /admin/invites/accept`. The API, in one transaction, with the code row locked (`SELECT … FOR UPDATE`, so parallel guesses can't race the counter):
   - checks that the user is `role = 'admin'`, not banned, and has **no** `credential` `account` row. If a password already exists, the request is refused. This endpoint is invite-only, so a 2FA-reset link can never set a password;
   - checks the token against `admin-2fa-enrol-<userId>` and that it has not expired;
   - checks the code against `admin-invite-code-<userId>` and that it has not expired. A wrong code increments the counter. **On the 5th failure the API deletes both the code and the setup token** and writes `ADMIN_INVITE_LOCKED`. The invitee then needs a resend;
   - on success: writes the `credential` `account` row with `hash_password()` (Better Auth's scrypt format), sets `emailVerified = true` (the link proves the address), deletes the code row, and writes `ADMIN_INVITE_ACCEPTED`. The setup token stays, because TOTP setup still needs it.

   Every failure returns the same message ("This invite link or code is not valid. Ask the admin who invited you to resend it."), so the response never says which part was wrong. The endpoint is public on the API, so it also gets the API's per-IP rate limit.

   On success the page sends the invitee to `/admin/login` with `/two-factor/enrol?token=<token>` as the next page.

3. **Set up TOTP.** The invitee signs in with email and password. The session has `twoFactorEnabled = false`, so the admin layout redirects to `/two-factor/enrol`. Setup works exactly as today: it needs the session, the password typed again (Better Auth's `shouldRequirePassword` on `/two-factor/enable`), and the valid, unused setup token (the `before` hook on `/two-factor/enable` in `lib/auth.ts`). `/two-factor/verify-totp` turns 2FA on and deletes the token (the existing after-hook).

   That after-hook also calls `POST /admin/two-factor/enrolled` on the API. The API writes `ADMIN_TWO_FACTOR_ENROLLED` only if the database already shows `twoFactorEnabled = true` for that user, so the call cannot fake a completion. If the call fails, setup still succeeds and the failure is logged.

4. **First real sign-in.** Sign out, sign in with password + TOTP. Only that `mfa=true` session reaches the admin area and API (today's rule; no "inactive" state is needed).

**Resend invite** (only while the invitee has no password): a new token and a new code, both 24 hours. The old ones are deleted. Audit: `ADMIN_INVITE_RESENT`.

### 2FA reset

Unchanged in spirit from today: password + new link. No out-of-band code.

- Another admin presses **Reset 2FA**. The API clears the `twoFactor` rows, trusted devices, any open setup token and all sessions (the existing `clear_two_factor`), and sets `twoFactorEnabled = false`. It then issues a new 24-hour setup link, sends it by SMS and email (the existing `admin_enrolment.deliver`), and writes `TWO_FACTOR_RESET`.
- If the target has no password yet (an invite not accepted), the API refuses and points to **Resend invite**.
- When that admin next signs in with email + password, the admin layout sees `role === 'admin'` with `twoFactorEnabled === false` and redirects to `/two-factor/enrol`. This replaces today's "Two-step verification required" gate card. Every other admin route stays closed, and the admin API keeps refusing tokens without `mfa`.
- **Setup still requires a valid, unused setup token from the reset or invite link.** With no token, the enrol page shows "Use the setup link we sent you." and offers nothing else.
- Completion is audited the same way as for an invite (`ADMIN_TWO_FACTOR_ENROLLED`).

"Fresh sign-in / password check before sensitive 2FA changes" means the controls already in place, not new ones: `shouldRequirePassword` on `/two-factor/enable`, and the `mfaVerified` check on the TOTP secret paths (`TOTP_SECRET_PATHS` in `lib/auth.ts`).

### Deactivate and reactivate

- **Deactivate** keeps `role = 'admin'` and sets `banned = true`, `banReason = 'Admin access removed'`. It runs `clear_two_factor` (2FA rows, trusted devices, setup token, sessions), deletes any invite code row, and writes `ADMIN_DEACTIVATE`. Better Auth refuses sign-in for banned users. Because the role stays `admin`, G2 keeps hiding the account's rows from the public login. History and audit rows are kept.
- **Refusals:** the actor deactivating themselves; deactivating the last active admin. "Active admin" means `role = 'admin' AND banned IS NOT TRUE AND "twoFactorEnabled" = true`: someone who can actually sign in. A pending invitee does not count. The check runs in the same transaction as the update, after `SELECT … FROM "user" WHERE role = 'admin' AND banned IS NOT TRUE FOR UPDATE`, so two admins cannot deactivate each other at the same moment.
- **Reactivate** sets `banned = false`, clears `banReason`, and writes `ADMIN_REACTIVATE`. If the account has a password, it issues a 2FA setup link (as a reset). If it never accepted its invite, it issues a fresh invite (new token and code, shown to the reactivating admin).
- `is_admin(user_id)` in the guards is `role = 'admin'` only, whether banned or not. It decides what the public login can touch, and a deactivated admin's rows stay protected. The last-admin rule above is a separate, stricter count.

### `make_admin.py`

Run in the API service shell, as `carabao_api`.

- `--create --email … --name …`: makes a new admin account with email + password (prompted twice), issues the setup link, and prints it. No out-of-band code: the operator at the shell is the one handing it over. Audit actor `system`.
- `--recover <email>`: for an existing **admin** account only. It clears 2FA, any ban and all sessions, then prints a new setup link. This is the break-glass path when no admin can sign in. Audit actor `system`.
- Promoting a non-admin account is refused.

## 3. Access per table

S/I/U/D = SELECT / INSERT / UPDATE / DELETE. "Guarded" means a guard in section 4 narrows it.

| Table | web_public | web_admin | api |
|---|---|---|---|
| `user` | SIUD, guarded | S, U, guarded (sign-in and TOTP setup; no role, ban or 2FA-off changes) | S; I (invite, `make_admin --create`); U (`role`, `banned`, `banReason`, `banExpires`, `twoFactorEnabled`, `emailVerified`, `image`, `updatedAt`); D (account delete, refused in code for admins) |
| `session` | SIUD, guarded | SIUD | S, D (revoke on reset, deactivate, ban) |
| `account` | SIUD, guarded | S, U (sign-in, password change) | S, I, U (invite acceptance, `make_admin --create`) |
| `verification` | SIUD, guarded | SIUD, guarded | S, I, U, D (setup tokens, invite codes and their attempt counter, trusted-device cleanup) |
| `twoFactor` | S (to confirm: may need none) | SIUD (TOTP setup) | S, D (2FA reset, deactivate) |
| `rateLimit` | SIUD | SIUD | none |
| `jwks` | S, I | **none** | none |
| `jwks_admin` | **none** | S, I | none |
| business tables, audit tables, `alembic_version` | **none** | **none** | SIUD (+ sequence USAGE) |

The API's column list comes from reading [better_auth_store.py](../../backend/app/services/better_auth_store.py) plus the new invite writes. web-admin's `account` S, U and `user` S, U are the smallest sets that Better Auth's sign-in, password change and TOTP setup should need. Confirm both in the integration test (section 7), not by hand.

## 4. Guards

All guard functions are owned by `carabao_owner` with `search_path` fixed. Each one lets through `carabao_api`, `carabao_owner` and superusers. The superuser exception is what makes rollback work: if a service is pointed back at the old login, nothing breaks.

**Which functions are `SECURITY DEFINER`.** Only the lookup helpers `is_admin(user_id)` and `is_admin_phone(phone)`, so policies can read `"user"` regardless of the caller's RLS. The G1 trigger function must be `SECURITY INVOKER` (the default): inside a `SECURITY DEFINER` function `current_user` is the function owner, so a check like `current_user IN ('carabao_api', 'carabao_owner')` would always pass and the guard would let everyone through. The trigger checks `current_user` and, for the superuser exception, `(SELECT rolsuper FROM pg_roles WHERE rolname = current_user)`. Do not check `session_user`: it ignores `SET ROLE` and makes the test harness in section 7 misleading.

**G1. Role, ban and turning 2FA off belong to the API.** A `BEFORE INSERT OR UPDATE` trigger on `"user"`, for both web logins:
- On insert: `role` must be NULL or `'user'`, and `banned` must be false or NULL.
- On update: `role`, `banned`, `banReason` and `banExpires` must not change, and `twoFactorEnabled` must not go from `true` to `false`.

This closes promoting yourself, signing up as an admin, unbanning yourself and turning off your own 2FA.

*Checked in Better Auth 1.7.26* (`dist/plugins/two-factor/`): the only write of `twoFactorEnabled: false` is `/two-factor/disable` (`index.mjs:275`), which `lib/auth.ts` already refuses for admins. `/two-factor/enable` (`index.mjs:173, 197`) and verify-totp (`totp/index.mjs:172-174`) only write `true`, and only when the flag is `false`. `/two-factor/enable` also refuses a user with a verified TOTP row (`TOTP_ALREADY_ENABLED`). So setting 2FA up again after an API reset goes false → true, which G1 allows. Recheck this whenever Better Auth is upgraded.

**G2. The public login cannot touch admin accounts.** Row-level security for `carabao_web_public`, through a helper `is_admin(user_id)` (`role = 'admin'`, banned or not):
- `user`: every row readable, so email uniqueness and sign-in lookups work. UPDATE and DELETE only where `role IS DISTINCT FROM 'admin'`.
- `account`, `session`, `twoFactor`: rows of admins are invisible and unwritable. An admin's password hash is never visible to the public deploy.

This closes changing an admin's password, wiping their TOTP and turning off their 2FA flag.

**G3. Tokens and codes for admins come only from the API.** RLS on `verification`.

For `carabao_web_public`:
- `admin-2fa-enrol-%` and `admin-invite-code-%` rows are invisible and cannot be inserted.
- Refuse a password-reset row whose user is an admin. Better Auth 1.7.26 writes two kinds (checked in `node_modules/better-auth`):
  - Email reset (`api/routes/password.mjs`): identifier `reset-password:<token>`, value = the user's id. Policy: refuse when `identifier LIKE 'reset-password:%' AND is_admin(value)`.
  - SMS reset (`plugins/phone-number/routes.mjs`): identifier `phone-number-reset-<phone>`, value `<code>:<attempts>`. Policy: refuse when `identifier LIKE 'phone-number-reset-%'` and the number after the prefix belongs to an admin (`is_admin_phone(phone)`, a second `SECURITY DEFINER` helper).

For `carabao_web_admin`:
- `admin-2fa-enrol-%`: readable and deletable (the `/two-factor/enable` hook checks it and the verify-totp after-hook deletes it), but never inserted or changed.
- `admin-invite-code-%`: no access at all. Only the API checks the code and counts attempts.

As policies: `USING (identifier NOT LIKE 'admin-invite-code-%')` for every command, and `WITH CHECK (identifier NOT LIKE 'admin-2fa-enrol-%' AND identifier NOT LIKE 'admin-invite-code-%')`.

These prefixes only exist because identifiers are stored in plain text: `lib/auth.ts` sets no `verification.storeIdentifier` and no `secondaryStorage`. If either is ever turned on, identifiers become hashes or leave the table, and G3 silently matches nothing. Add a comment in `guards.sql` and `lib/auth.ts`. The integration test catches it too, because it asserts that the admin reset insert fails.

G3 is defence in depth. Under G2 an admin's `account` row is invisible to the public login, so even a planted reset token cannot change an admin's password.

**G4 (optional, later). The admin login cannot touch non-admin accounts.** This is the same rule the other way round. It matters less, because web-admin is behind Cloudflare Access and has a much smaller attack surface.

## 5. Code changes

### `lib/auth.ts`: public-site admin refusal (about 20–30 lines, ship first)

Today the public deploy refuses an admin by creating the session and then deleting it (`noAdminsOnPublicSurface`). Under G2 that insert fails with a database error, which would show an error page. So:
- Refuse in `databaseHooks.session.create.before` and `databaseHooks.account.create.before` when the user is an admin.
  - Non-GET requests (password, phone, two-factor): throw the same `APIError("FORBIDDEN", { code: "ADMIN_ACCOUNT", ... })` as today.
  - GET requests (OAuth callbacks): throw `APIError("FORBIDDEN", { code: "admin_account", message: ADMIN_ACCOUNT_MESSAGE })`, **not** `ctx.redirect(...)`. Checked in `api/routes/callback.mjs`: the callback wraps `handleOAuthUserInfo` (which creates the account and the session) in a try/catch. An APIError carrying `body.code` becomes a redirect to the sign-in's `errorCallbackURL` with `?error=<code>&error_description=<message>`. `socialErrorMessage("admin_account")` in `lib/auth-client.ts` already shows the right text. This is better than today's redirect: it respects the merchant login page's own `errorURL`, where the current after-hook always sends you to `${appBaseUrl}/auth`. A thrown `ctx.redirect` would also reach the browser (it has no `body.code`, so it is re-thrown as a 302), but it loses `errorURL`.
- Keep the after-hook as a second check.
- **Refuse password-reset requests for admins quietly**, in a `before` hook on `/request-password-reset` and `/phone-number/request-password-reset`. If the email or number belongs to an admin, return the same "If this email exists…" / success response without writing anything. Without this, the G3 policy turns the insert into a database error, and the error page tells an attacker the address or number is an admin's.

This works with today's single login too.

### Admin accounts (section 2): API, web-admin, script

**API** (`routes/admin.py`, `admin_enrolment.py`, `better_auth_store.py`, `audit_log`):
- New: `POST /admin/invites`, `POST /admin/invites/{user_id}/resend`, `POST /admin/invites/accept` (public, rate-limited), `POST /admin/admins/{user_id}/deactivate`, `POST /admin/admins/{user_id}/reactivate`, `POST /admin/two-factor/enrolled`.
- New store functions: create an admin `user` without an `account`, set and check the invite code with its attempt counter, write the `credential` account for an accepted invite, set `emailVerified`.
- New audit actions: `ADMIN_INVITE`, `ADMIN_INVITE_RESENT`, `ADMIN_INVITE_LOCKED`, `ADMIN_INVITE_ACCEPTED`, `ADMIN_TWO_FACTOR_ENROLLED`, `ADMIN_DEACTIVATE`, `ADMIN_REACTIVATE`.
- Changed: 2FA reset refuses an admin with no password yet; ban/unban refuse admin targets; account delete refuses admin targets.
- Removed: `PATCH /admin/users/{id}/role` and `set_role`'s promote path.

**web-admin:**
- New `/admin/invite` page and its route handler, which forwards to the API.
- Admin users page: an Invite admin form that shows the code once; Resend invite, Deactivate and Reactivate buttons. The promote/demote toggle is removed.
- Admin layout: `twoFactorEnabled === false` redirects to `/two-factor/enrol` instead of showing the gate card. The `mfaVerified` gate stays as it is.
- Enrol page: with no token, show only "Use the setup link we sent you."
- `lib/auth.ts`: the verify-totp after-hook also calls `POST /admin/two-factor/enrolled`.

**`scripts/make_admin.py`:** `--create` and `--recover` as in section 2. The promote mode is removed.

**Docs:** rewrite `Admin creation.md` for the invite flow, with `--create` and `--recover` as the only script paths.

### Behaviour changes to expect (no security impact)

- An admin's password sign-in on the public site says "invalid email or password", because the password row is hidden.
- An admin account with a Google link: under G2 the public login can't see the admin's `account` rows, so Better Auth treats the Google account as not linked. Depending on the account-linking rules it either tries to link it, which `account.create.before` refuses with `admin_account` (the friendly message), or answers `account_not_linked` ("That email already belongs to a Carabao account…"). Neither leaks anything or creates a session. Check which one appears in testing. New admins made by invite never have a Google link, so this only affects existing admins.

### Migrations

No schema rewrite needed. Run them with `DATABASE_URL` set to the owner login (Alembic reads `DATABASE_URL` in `backend/alembic/env.py`).

## 6. New files

- `backend/db/roles.sql`: create the logins (idempotent), take ownership, grants, default privileges. Passwords are not in the file; pass them as psql variables. Taking ownership is a `DO` block that loops over every table, sequence, view and type in `public` still owned by `postgres` and runs `ALTER ... OWNER TO carabao_owner`. `REASSIGN OWNED BY postgres` can't be used, because Postgres refuses it for the bootstrap superuser's system objects. Also `GRANT CREATE ON SCHEMA public TO carabao_owner`. On an empty database the loop does nothing, so the same file serves the integration test, the fork rehearsal and production.
- `backend/db/guards.sql`: the G1–G3 functions, triggers and policies (idempotent: `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
- `backend/tests_pg/test_db_roles.py`: the Postgres integration test (section 7).
- `backend/db/backup.ps1`: dump a database and prove the dump restores (section 8, step 4).
- `backend/db/apply_roles.ps1`: run `roles.sql` and `guards.sql` against a database, check the end state, and optionally set the service logins' passwords (section 8, step 5).
- SUBDOMAINS.md: a new "Database logins" section and the deploy steps below. LOCAL_DATABASE.md: how to run the integration test.

Default privileges: `ALTER DEFAULT PRIVILEGES FOR ROLE carabao_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carabao_api` (and USAGE on sequences). A new Alembic table then reaches the API on its own. The web logins get **no** default privileges: a new Better Auth table stays closed until `guards.sql` grants it. That fails closed and loudly, as a sign-in error.

## 7. Tests

### Backend tests (existing SQLite suite), for the admin-account rules

- Invite: refused for an email that already has an account; creates the user with no password, a setup token and a code; the code is returned once and only its hash is stored; audit row written.
- Accept: token without the code fails; code without the token fails; an expired token or code fails; every failure gives the same message.
- Wrong code 5 times deletes both the code and the setup token; the right code after that fails.
- A 2FA-reset token cannot set a password on an admin who already has one.
- Resend replaces both token and code; the old ones stop working.
- Deactivate: refused for yourself and for the last active admin; a pending invitee doesn't count as active; clears 2FA, sessions and the invite code.
- Reactivate: with a password → setup link; without → fresh invite.
- 2FA reset refused for yourself and for an admin with no password.
- `PATCH /admin/users/{id}/role` is gone. Ban, unban and account delete refuse admin targets.
- `make_admin.py`: `--create` works; `--recover` works on an admin and refuses a non-admin; promote mode is gone.
- `POST /admin/two-factor/enrolled` writes nothing while `twoFactorEnabled` is still false.

### Postgres integration test, for the logins and guards

The backend tests run on SQLite and cannot see roles or RLS. Add an opt-in Postgres test that runs only when `PG_TEST_URL` is set. Run it locally (Docker `postgres:17`, the same as LOCAL_DATABASE.md) and before every deploy that touches auth tables.

It applies `auth:migrate:apply`, `alembic upgrade head`, `roles.sql` and `guards.sql` to an empty database, then checks the following.

**Run the checks as the service logins, never as `postgres`.** `postgres` is a superuser with `rolbypassrls`, and the guards let superusers through, so every "must fail" check would wrongly pass and every "must work" check would prove nothing. Setup (migrations and the role SQL) runs as the superuser or `carabao_owner`. Each check then opens its own connection as `carabao_web_public`, `carabao_web_admin` or `carabao_api` (test passwords set by the fixture). The first assertion on every check connection is that `current_user` is the expected role and that `rolsuper` and `rolbypassrls` are both false for it. The same rule applies to the post-switch smoke tests in section 8: they go through the services, which use the role logins, not through a `postgres` psql session.

**Must fail as `carabao_web_public`:** promote self; insert a user with `role='admin'`; unban self; read or write `jwks_admin`; read an admin's `account` row; update an admin's password; delete or overwrite an admin's `twoFactor` row; set `twoFactorEnabled=false` on an admin; insert or read an `admin-2fa-enrol-` row; insert or read an `admin-invite-code-` row; insert a `reset-password:` token whose value is an admin's id; insert a `phone-number-reset-` row for an admin's number; read `payout_batches`, `orders` or `merchant_applications`; `ALTER TABLE ... DISABLE TRIGGER`; `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`; `CREATE TABLE`.

**Must fail as `carabao_web_admin`:** read or write `jwks`; read business or audit tables; change a role or ban; set `twoFactorEnabled` true → false; insert a `user` or `account` row; insert or update an `admin-2fa-enrol-` row; read, insert, update or delete an `admin-invite-code-` row.

**Must work:**
- Public: buyer sign-up, sign-in, session refresh and password reset.
- web-admin: sign-in, password change, reading and deleting an `admin-2fa-enrol-` row, TOTP setup (twoFactor rows, `twoFactorEnabled` false → true), first-key creation in `jwks_admin`.
- API: every write in section 2 (invite, resend, accept with the attempt counter, deactivate with `FOR UPDATE`, reactivate, 2FA reset), ban, unban, avatar change, buyer account delete, `make_admin.py --create` and `--recover`.

The end-to-end web flows (Better Auth against the role logins) are a manual checklist run on a staging copy: invite → accept → sign in → set up TOTP → sign in with code; reset → redirect to setup → set up again; deactivate → sign-in refused → reactivate. Extend SUBDOMAINS.md section 6 with them.

## 8. Rollout on Railway

**Production data today (2026-11-22).** No important data is in production, only seeded data and a few admin records that can be recreated. So wiping and rebuilding was considered alongside migrating in place.

**Chosen: migrate in place.** Wiping is only marginally simpler, so in place wins:

- In place, no rows move. The only "migration" is the ownership loop in `roles.sql` (about 15 lines). That loop is a no-op on an empty database, so `roles.sql` is the same file either way.
- A wipe removes that loop, but adds work: drop and recreate the schema as `carabao_owner`, rerun both migrations, reseed, recreate the admins with `make_admin.py --create`, set up their TOTP again, and regenerate `jwks_admin`. The last one means updating `ADMIN_JWKS_THUMBPRINTS` on the API in the same step, or admin tokens are refused.
- Rollback stays a variable change either way, because the guards let `postgres` through.

**Progress.** When a step below is completed, mark it the same way as steps 0 and 1: ✅ **Completed YYYY-MM-DD**, with the branch and any notes, and update the status line at the top of this file.

**Fallback:** if the ownership loop hits something unexpected during the fork rehearsal (step 3), wipe and rebuild instead. The data allows it today. Back up first (step 4) either way.

0. **Check first** ✅ **Passed 2026-11-22.** Railway Postgres (`pgssl:17`), server 17.11 (Debian 17.11-1.pgdg13+2). Session user `postgres` has `rolsuper`, `rolcreaterole`, `rolcreatedb` and `rolbypassrls`, so `CREATE ROLE`, `ALTER TABLE ... OWNER`, RLS, triggers and `SECURITY DEFINER` functions are all available. Local Docker `postgres:17` matches the major version.
1. Ship the `lib/auth.ts` public-site change (section 5) and confirm the admin-refused message still works. ✅ **Completed 2026-11-22** (branch `db-role-split`). Also fixed: `lib/otp-cooldown.ts` used old row names (`<phone>` and `<phone>-request-password-reset`), so the server-side 60-second resend wait and the Semaphore code override never matched a row; it now uses Better Auth 1.7.26's `phone-number-otp-<phone>` and `phone-number-reset-<phone>`. A refused admin phone reset writes a `phone-reset-wait-<phone>` row with no code, so the resend wait for an admin's number looks the same as for any other number.
2. Ship the admin-account changes (section 2, section 5) on today's single login. Run the backend tests and the manual checklist (section 7): invite, accept, TOTP setup, reset, deactivate, reactivate, `make_admin.py --create` and `--recover`. Existing admins keep working; they are already admins with TOTP. Update `Admin creation.md`. 🟡 **Code done 2026-11-22** (branch `db-role-split`); backend tests pass (1285, new `tests/test_admin_accounts.py`). **Still to do before marking it completed: the manual checklist**, now SUBDOMAINS.md section 6 rows 16–25. Where it differs from sections 2 and 5:
   - **Invite acceptance goes from the browser straight to the API**, not through a web-admin route handler. `POST /admin/invites/accept` is public anyway, and this way its per-IP rate limit (`admin_invite_accept`, 20 per IP and 10 per invite per 15 minutes) sees the invitee's IP, not web-admin's. web-admin's database login still never writes an `account` row.
   - **A wrong token does not count against the code.** Only a guess made with the right token moves the counter, so knowing an invite id alone cannot lock someone else's invite.
   - `POST /admin/two-factor/enrolled` is authenticated with `AUTH_SYNC_SHARED_SECRET` (body `{user_id}`), and writes the audit row at most once per setup (not again until the next invite, resend, reset, reactivation or script run).
   - Audit actions are named `admin.invite`, `admin.invite_resent`, `admin.invite_locked`, `admin.invite_accepted`, `admin.two_factor_enrolled`, `admin.deactivate`, `admin.reactivate`, plus `admin.create` and `admin.recover` for `make_admin.py`. `user.role_change` is no longer written; it stays filterable for old rows.
   - `make_admin.py --recover` on an admin who never accepted the invite also asks for a password.
   - 2FA reset is also refused for a deactivated admin (reactivate first). Resend is refused once the invite is accepted.
   - `better_auth_store.set_role` is removed. `GET /admin/users` gains `admin_invite_pending`.
   - Local dev: with no `RESEND_KEY` and `APP_ENV=development`, the invite link is logged by the API instead of emailed.
3. Rehearse on a Railway fork of the database: run steps 5–8 there against copies of the services. 🟡 **Local part done 2026-11-22** (branch `db-role-split`): `backend/db/roles.sql`, `backend/db/guards.sql` and `backend/tests_pg/test_db_roles.py` (12 tests) pass on Docker `postgres:17`, each file run twice on a database built as the superuser (so the ownership loop had real work). A one-off script also ran Better Auth 1.7.26's real endpoints against the role logins. As `carabao_web_public`: sign-up, sign-in, session, `/token` (first `jwks` key), profile update, email reset; admin password sign-in gave "invalid email or password". As `carabao_web_admin`: sign-in, TOTP enable and verify, the 2FA sign-in step with a trusted device, `/token` (first `jwks_admin` key), password change, reset request; `/two-factor/disable` was refused by G1 in the database. Docs: SUBDOMAINS.md section 3.1, LOCAL_DATABASE.md section 11, and the `storeIdentifier` comment in `lib/auth.ts`. **Still to do: the fork rehearsal itself.** Where the build differs from sections 3, 4 and 6:
   - **Passwords** are set with psql's `\password` after `roles.sql`, not passed as psql variables. They never appear on a command line. The service logins have no password until then, so they cannot sign in.
   - `carabao_owner` is created `NOLOGIN` (step 9's end state from the start). It gets `LOGIN` only while a migration runs (SUBDOMAINS.md 3.1).
   - **`carabao_api` is tighter than the section 3 table.** It has no UPDATE on `"user".role`, because nothing promotes since step 2 (`set_role` is gone). It has `account` S, I only: invite acceptance and `make_admin` insert, and nothing updates. The column UPDATE on `"user"` is also what `lock_active_admins`' `FOR UPDATE` needs.
   - **G3 also covers** `trust-device-%` and `2fa-%` rows whose value is an admin's id. The public login can neither see nor make them. Only the admin site has a reason to.
   - RLS on a hidden row filters silently (0 rows, no error). Only a WITH CHECK, a missing grant or G1 raises an error. So "must fail" checks on admin rows assert that nothing changed.
   - Better Auth's expired-row cleanup (`DELETE ... WHERE "expiresAt" < now`) runs fine under both web logins. It just skips rows they cannot see.
   - The test builds the API tables with `create_tables.py` + `alembic stamp head`, because `alembic upgrade head` fails on an empty database (LOCAL_DATABASE.md 10.5).

   ✅ **Rehearsed 2026-11-22 on a local restore of the production dump** (branch `db-role-split`), in place of a Railway fork.

   **Why not a fork.** Three `fork-create` runs of `production` all failed the same way: "rotating its database password … failed: Couldn't connect to the database to change its password: Connection terminated unexpectedly". Railway deleted each fork and its `fork/<key>` branch, so nothing was left behind. Production stayed healthy throughout (every service online, Postgres logs clean). The cause is on Railway's side (probably the `postgres-ssl:17` image not accepting the fork tool's connection while it starts). So the rehearsal ran on the step 4 dump instead, restored with owners and grants into a separate Docker `postgres:17` (port 5434), with all three services run locally on their own logins.

   **Database (step 5 on production's data).** Before: 39 tables, 30 sequences and 192 indexes in `public`, all owned by `postgres`. No RLS, no triggers, extensions `plpgsql` only. 4 users (3 admins, 1 of them with 2FA; 1 buyer), 5 `account` rows (4 belong to admins, so one admin has a second provider, probably Google), 1 `twoFactor`, 2 open `admin-2fa-enrol-` tokens.
   - `psql -v ON_ERROR_STOP=1 -f roles.sql -f guards.sql` as the superuser, **twice**: exit 0 both times, about 0.3 s each. Only output: the expected `trigger "guard_user_write" … does not exist, skipping` notice on the first run.
   - After: every table, sequence and index owned by `carabao_owner` (261 objects), plus the 4 guard functions. RLS on `user`, `account`, `session`, `twoFactor`, `verification` (18 policies), trigger `guard_user_write`. The four logins: not superuser, not BYPASSRLS, no memberships, no password yet; `carabao_owner` `NOLOGIN`. Only `carabao_owner` has `CREATE` on `public`. Row counts unchanged.
   - `tests_pg` (12 tests) against the same server, with the roles already there: **12 passed**.
   - Checks as each login against the **real** rows (rehearsal script, not in the repo): **53/53 passed**. Public login: every `user` row readable; the real admins' `account`, `session` and `twoFactor` rows and both setup tokens invisible; updates of real admins and their passwords change 0 rows; deleting the real admin's TOTP row refused (no DELETE grant at all, stricter than section 3's table); promoting or banning the real buyer refused by G1, while a normal profile update works; a `reset-password:` row for a real admin refused by G3; `jwks_admin` and the business and audit tables refused; `DISABLE TRIGGER`, `DISABLE ROW LEVEL SECURITY` and `CREATE TABLE` refused. Admin login: real admin accounts and setup tokens visible; `jwks` and the business tables refused; turning off the real admin's 2FA, demoting an admin, inserting a setup token or a user all refused. API login: business, audit and Better Auth tables readable; `jwks_admin` refused; `role` not writable; `banned` writable; the `FOR UPDATE` admin lock works. No real `user` row changed.

   **Services (steps 6–8).** API (`carabao_api`), public web (`carabao_web_public`) and web-admin (`carabao_web_admin`) run locally against the restored data, driven over HTTP: **60/60 passed**.
   - Step 8, public: phone sign-up (code → verify → set password), profile update, phone + password sign-in, session, `/token` (first `jwks` key), the token accepted by the API, SMS password reset end to end, sign-in with the new password, sign-out. An email reset for a real admin answers the same as any other and writes nothing. The rehearsal admin's **correct** password on the public site gives "Invalid email or password".
   - Step 7, web-admin: buyer sign-in refused; `make_admin --create` admin signs in, has `twoFactorEnabled = false`; TOTP setup without the link token refused, with it works and the token is deleted; `/two-factor/disable` refused; password + TOTP sign-in; `/token` (first `jwks_admin` key); password change.
   - Step 6, API with an `mfa` admin token: users list, stats, audit log; invite (refused for an email that already has an account); resend; accept with a wrong code (refused, counter goes to `:1`) then the right code; invitee signs in and sets up TOTP, `admin.two_factor_enrolled` written by the after-hook; self-deactivation refused; deactivate, sign-in refused; reactivate, setup link, TOTP again; self 2FA reset refused; 2FA reset, password sign-in has no TOTP step, TOTP again; buyer suspend and reinstate; plain suspend of an admin refused; buyer account delete (code, then delete) removes the Better Auth row; `make_admin --recover` works on an admin and refuses a non-admin.
   - No permission errors and no 500s in any of the three server logs.

   **Rehearsal set-up that differs from production (not findings).** The restored `jwks` and `jwks_admin` private keys are encrypted with production's `BETTER_AUTH_SECRET`, so in the copy they were set aside and the role logins made new first keys. Outbound SMS and setup emails were replaced with log lines (database code untouched). The public web used Cloudflare's always-pass Turnstile test key. `make_admin.py`'s own `create_admin`/`recover_admin` were called directly, because its password prompt needs a terminal.

   **Findings.**
   1. **`scripts/admin_jwk_thumbprints.py` fails as `carabao_api`** ("permission denied for table jwks_admin"); it works as the superuser. The docs said to run it in the API service shell. Fixed in the docs (Admin creation.md, SUBDOMAINS.md step 6a) and the script's docstring: run it from your machine with `DATABASE_URL` = the superuser's public URL. It doesn't block steps 5–8: the existing admin key stays, so no new thumbprint is needed when the logins switch, only at the next admin key rotation.
   2. **Not covered locally:** Railway's TLS settings (`PGSSL_CA`, `PGSSL_SERVERNAME`) with the role URLs; `${{…}}` variable references; Google sign-in (needs HTTPS); the real production keys read through the role logins with the real secret (the SELECT grants on `jwks` and `jwks_admin` were checked on the real rows). All of these show up right after each switch in steps 6–8, and rollback is a variable change.
   3. **One existing admin has a second `account` row** (probably Google). Under G2 that link is invisible to the public login. Check what the public site shows if that admin tries Google there (section 5, "Behaviour changes").
4. Back up the production database. 🟡 **Logical dump done 2026-11-22; Railway volume backup still to do.** Dump: `carabao-20261122-082203Z.dump` (167,770 bytes), SHA-256 `caab40ae1296ed8c254eb47fc37c76226e9b0e70faeed8f35385ea0637fd7d7d`, taken 2026-11-22 08:22 UTC. 39 tables, every row count matched the restore. It was also restored with owners and grants (no `--no-owner`) for the step 3 rehearsal, cleanly. The first run made a 0-byte file and failed straight after connecting (the error wasn't captured); a rerun worked. `backup.ps1` now deletes the dump file when a run fails, so an empty file can't pass for a backup. **Retake the dump right before step 5** if production has changed since, and make the Railway volume backup then. Take two copies:
   - **Volume backup (Railway).** Railway > Postgres > Backups > Create backup. Restoring it replaces the whole volume, roles and all, so it is the full rollback for step 5.
   - **Logical dump (`backend/db/backup.ps1`).** Needs Docker only. Run `powershell -ExecutionPolicy Bypass -File backend\db\backup.ps1` and paste the Postgres service's `DATABASE_PUBLIC_URL` (the superuser) at the hidden prompt. The script `pg_dump`s to `%USERPROFILE%\carabao-backups\carabao-<UTC time>.dump` (custom format, owners and grants kept), restores it into a throwaway `postgres:17` container, checks that every table in `public` has the same row count in both, and prints the file's SHA-256. It stops with an error if any count differs. The URL reaches the containers only as an environment variable, never on a command line. Tested 2026-11-22 against local Docker: 39 tables, every count matched.

   The dump holds password hashes, TOTP secrets and encrypted tax IDs: keep it out of the repo (`*.dump` is in `.gitignore`) and out of synced folders. Before step 5, note the dump's file name, SHA-256 and the time of the Railway backup here. To restore the dump in an emergency: `pg_restore --clean --if-exists --dbname=<superuser URL> <file>` (as `postgres`; the roles from step 5 must exist first if the dump was taken after it).
   **Go / no-go for step 5 (2026-11-22): GO**, once these are done:
   - the Railway volume backup (step 4), and a fresh `backup.ps1` dump if production changed after 08:22 UTC on 2026-11-22;
   - the step 2 manual checklist (SUBDOMAINS.md section 6 rows 16–25) on today's single login, which the rehearsal does not replace. The rehearsal ran the same flows against the role logins, all passing, so a failure there would be in the step 2 code, not the database change.

   Step 5 on its own is safe: the rehearsal ran it twice on production's data with no errors, it changes no rows, and nothing uses the new logins until step 6. Steps 6–8 also passed in the rehearsal. Do them one service at a time, with each service's rollback URL (the `postgres` login) at hand.
5. As the superuser, run `roles.sql`, then `guards.sql`. Nothing uses the new logins yet, so nothing changes. ✅ **Completed 2026-11-22** (branch `db-role-split`), with `backend/db/apply_roles.ps1 -SetPasswords` against `shortline.proxy.rlwy.net:56482 / railway` (Postgres 17.11).

   - **First run:** the preflight showed the expected state (`postgres 261`, no `carabao_*` logins, 0 RLS tables / 0 policies / 0 triggers). `roles.sql` and `guards.sql` applied and committed. The run then stopped at the `\password` prompt because a password was mistyped (the two entries didn't match). The Postgres log shows this as `could not receive data from client: Connection reset by peer` at 09:13:02 UTC.
   - **Second run (finished 09:15 UTC):** the preflight showed the split already in place (`carabao_owner 261`, all four logins, 5 RLS tables / 18 policies / 1 trigger, 39 tables). The re-apply took 23.8 s over the public proxy (1.1 s locally) and changed nothing. **All 14 checks ok**, row counts unchanged. Passwords set for `carabao_api`, `carabao_web_public` and `carabao_web_admin`, and confirmed.
   - **Afterwards:** every Railway service online with no issues (Backend, Web Application, Admin Web; Help Web sleeping as before), none redeployed. No `permission denied` or other errors in the Postgres or Backend logs since 08:50 UTC: the services still use the `postgres` login, which the guards let through.

   The rest of this step is the runner and how it was tested, kept for later re-runs.

   Run `powershell -ExecutionPolicy Bypass -File backend\db\apply_roles.ps1 -SetPasswords` and paste the Postgres service's `DATABASE_PUBLIC_URL` (the superuser) at the hidden prompt. The script:
   - refuses anything but a Postgres 17 superuser connection, then prints the host, database, owners in `public`, existing `carabao_*` logins, RLS, policy and trigger counts, and the table count. Before step 5 on production, expect `postgres 261`, no logins, and 0 / 0 / 0;
   - asks you to type the database name (on Railway usually `railway`; the script prints it) before it changes anything;
   - runs `roles.sql` then `guards.sql` with `ON_ERROR_STOP` (each file is one transaction);
   - checks the end state: all four logins exist; none is superuser, BYPASSRLS, CREATEROLE or CREATEDB; `carabao_owner` is `NOLOGIN`; no memberships; everything in `public` is owned by `carabao_owner`; only it has `CREATE`; RLS on the 5 guarded tables; 18 policies; trigger `guard_user_write` enabled; `is_admin`/`is_admin_phone` are `SECURITY DEFINER` and the other two guard functions are not; neither web login reaches a business or audit table; `jwks_admin` is closed to the public login and `jwks` to the admin login; the API cannot update `"user".role`; every row count is unchanged. It stops with an error if any check fails;
   - with `-SetPasswords`, opens psql's `\password` prompt for `carabao_api`, `carabao_web_public` and `carabao_web_admin` (hashed in psql, never on a command line), then checks that each has a password. Generate a long random password for each and keep them for steps 6–8.

   The URL reaches the containers only as an environment variable, never on a command line, as in `backup.ps1`.

   **Tested 2026-11-22** on a fresh Docker `postgres:17` restore of the step 4 dump: first run moved all 261 objects to `carabao_owner` in 1.1 s with only the expected `guard_user_write … does not exist, skipping` notice, and all 14 checks passed; a second run passed the same checks and changed nothing; `tests_pg` passed 12/12 against it. Refusal and failure paths: a `carabao_api` connection is refused before anything runs; after granting the public login `orders`, disabling the trigger, dropping a policy and setting `carabao_owner LOGIN`, the checks flagged all four, and a rerun repaired the first three and failed on `NOLOGIN` (the files deliberately leave `LOGIN` alone). `-SetPasswords` was not tested locally, because `\password` needs a real terminal.

6. Switch the API's `DATABASE_URL` to `carabao_api` and restart. Smoke-test invite, deactivate, reactivate and 2FA reset. ✅ **Completed 2026-11-22** (6a and 6b below; step 2 merged to `main` in #41).

   **Findings before the switch.**
   1. **Production's API runs `main`, not this branch.** The Backend service builds `Gbot-Prod/Carabao-Fin` `main` (root `/backend`). `db-role-split` is at the same commit as `main` (`bde9b1f`), and the code for steps 1–3 is uncommitted. So production has none of the step 2 endpoints yet (invite, resend, accept, deactivate, reactivate, `two-factor/enrolled`). Step 6's smoke test of those can only run once step 2 is merged and deployed. Hence the two parts below.
   2. **`main`'s API code under `carabao_api`.** Every database write in `main`'s `better_auth_store.py` is covered by the step 5 grants except `set_role` (`UPDATE "user" SET role`, behind `PATCH /admin/users/{id}/role` and `make_admin.py <email>`). As `carabao_api` that is refused by the database (no UPDATE on `role`). Promotion is meant to go away in step 2 anyway. Until then, the promote/demote button on the admin users page gives an error, and nothing changes. Don't use it.
   3. **The Backend runs `uv run alembic upgrade head` as a pre-deploy command, with the same `DATABASE_URL`.** Tested 2026-11-22 as `carabao_api` on a scratch database on the local test server (roles from `roles.sql`): with the database at head it is a no-op and exits 0, so deploys keep working. With a migration pending it fails (`must be owner of table merchants`, exit 1). On Railway a failed pre-deploy fails the deployment and the previous one stays live. **Keep the pre-deploy command** as a check: a deploy that brings a new migration now fails until the migration has been run as `carabao_owner` (SUBDOMAINS.md 3.1). Then redeploy. Don't put the owner URL on the API to make it pass (step 9). Production is at head today (`c3d5e7f9a1b4`), and the branch adds no migration.

   **6a. Switch now, on `main`'s code.** ✅ **Completed 2026-11-22 09:46 UTC.** The API runs as `carabao_api` (deployment `9c8008c2`). The pre-deploy `alembic upgrade head` passed, and so did every call made from the admin site afterwards: stats, payout batches, users list, suspend and reinstate of a buyer, 2FA reset of an admin. Backend and Postgres logs have no `permission denied` or other errors. Not exercised yet: avatar change and buyer orders. Watch the logs when they next happen. Two failed tries before it went live (both rolled back on their own: a failed pre-deploy keeps the old deployment live):
   - `database "railway\n" does not exist`: a line break pasted after the database name. Type the end of the URL by hand.
   - The user set to `carabao_owner`: `password authentication failed`. The owner is `NOLOGIN` with no password, and its URL never goes on a service (step 9).

   The steps, kept for the switches in steps 7 and 8:
   1. Railway > Carabao Backend > Variables > `DATABASE_URL`: copy the current value somewhere safe (it is the rollback URL). The new value is the same URL with only the user and password changed: `postgresql://carabao_api:<password>@<same host>:<same port>/<same database><same query string>`. Keep the host, port, database and any `?…` exactly as they are, because `PGSSL_CA` and `PGSSL_SERVERNAME` stay set and still match. If the password has characters other than letters, digits, `-`, `_`, `.` or `~`, percent-encode them.
   2. Save. Railway redeploys: the pre-deploy `alembic upgrade head` runs as `carabao_api` first (finding 3), then the API starts.
   3. Check: the deployment is live; the deploy logs have no `permission denied`, `InsufficientPrivilege` or `must be owner`; `GET /health` (or any public endpoint) answers.
   4. Smoke-test on the admin site (signed in with password + TOTP): users list, stats, audit log, orders and transactions pages; suspend and reinstate a test buyer; reset a test admin's 2FA (setup link sent, `TWO_FACTOR_RESET` in the audit log); on the public site, change a test buyer's avatar and place or view an order. Then check the Backend and Postgres logs again.
   5. **Rollback:** set `DATABASE_URL` back to the saved `postgres` URL and save.

   **6b. After step 2 is merged and deployed** (API and web-admin). ✅ **Completed and reviewed 2026-11-22**, after #41 was deployed: invite → accept with a wrong code then the right one → sign in → set up TOTP (`admin.two_factor_enrolled` in the audit log); deactivate → sign-in refused → reactivate → setup link; 2FA reset. The rehearsal already passed all of these as `carabao_api` (step 3).
7. Switch web-admin to `carabao_web_admin`. Test invite acceptance, sign-in, TOTP setup, the redirect to `/two-factor/enrol` after a reset, and API calls.

   **Before the switch (checked 2026-11-22).** The Carabao Admin Web service builds `main` (root `/frontend/carabao-app`) with no pre-deploy command, and `build`/`start` do not run `auth:migrate:apply`. So no step runs migrations as `carabao_web_admin`. Do the switch the same way as 6a (copy the `postgres` URL first, change only the user and password, keep host, port, database, query string, `PGSSL_CA` and `PGSSL_SERVERNAME`).
   ✅ **Completed 2026-11-22.** Switched and tested.
8. Switch web to `carabao_web_public`. Test buyer sign-up, sign-in, reset, Google sign-in and the admin-refused message. ✅ **Completed 2026-11-22.** Switched and tested.
9. Set `carabao_owner` to `NOLOGIN` between migrations, or keep its URL out of every service. Leave `postgres` enabled (section 1). Check that no service still references `${{Postgres.DATABASE_URL}}` or another variable that resolves to the `postgres` login; each service's `DATABASE_URL` must be its own role URL.

   **What step 9 is.** It is a final check, not a change. The guards let every superuser through (section 4), so one service that still connects as `postgres` cancels the role split for that service. Step 9 makes sure that no such leftover exists.
   - `carabao_owner` is `NOLOGIN` since step 5 (`roles.sql` makes it so, and `apply_roles.ps1` checks it). Nothing to do, except to keep it `NOLOGIN` after each migration (SUBDOMAINS.md 3.1).
   - **Variables (checked 2026-11-22 with the Railway MCP, names only, values hidden).** Carabao Backend, Carabao Admin Web and Carabao Web Application each have one `DATABASE_URL`. Carabao Help Web has no database variable. The values must still be checked by hand: in Railway > each service > Variables > `DATABASE_URL`, the raw value must start with `postgresql://carabao_api:`, `postgresql://carabao_web_admin:` or `postgresql://carabao_web_public:`, and must not contain `${{Postgres.`. Also make sure that no other variable (for example `DATABASE_PUBLIC_URL` or `PGUSER`) was copied into a service.
   - **Live check (as the superuser, in psql):**
     ```sql
     SELECT usename, count(*) FROM pg_stat_activity
     WHERE datname = current_database() AND backend_type = 'client backend'
     GROUP BY usename ORDER BY usename;
     ```
     Expect `carabao_api`, `carabao_web_admin` and `carabao_web_public`, and `postgres` only for your own psql session (count 1). More `postgres` connections mean that something still uses the superuser login. Find it with `client_addr` and `application_name` from the same view.
   - When both checks pass, mark step 9 completed here.

   ✅ **Completed 2026-11-22.** Each service's `DATABASE_URL` checked by hand: its own role login, no `${{Postgres.…}}` reference. Live check: `carabao_api 2`, `postgres 1` (the psql session of the check itself). The web logins had no open connection at that moment, which is normal: their pools close idle connections. **The plan is complete.**

**Rollback** for any step from 5 on: point that service's `DATABASE_URL` back at the `postgres` login and restart. The guards let the superuser through, so the old setup works with them in place.

**From then on:** run every migration as the owner, and re-run `guards.sql` after any `auth:migrate:apply`. Put both in the SUBDOMAINS.md deploy steps.

## 9. Decisions (settled 2026-11-22)

1. **G4: later.** Not part of this rollout.
2. **Local dev keeps one full-access login.** The day-to-day local `DATABASE_URL` stays simple; the role logins are exercised only by the opt-in integration test (section 7), which connects as each service login.
3. **Railway fork rehearsal: timing open.** Decide once `roles.sql`, `guards.sql` and the integration test are done and passing locally. It needs a little database time and copies of three services.
4. **Admin accounts are invite-only**, with the link by email and an out-of-band code handed over by the inviting admin. The code and the link both last 24 hours, and the 5th wrong code kills both.
5. **The invite password is written by the API**, through a web-admin route handler. web-admin's login gets no `account` insert, and every step is audited.
6. **Removing an admin = deactivation** (`banned = true`, role kept). Admin accounts cannot be deleted for now.
7. **2FA reset = password + new link**, no code. `make_admin.py` is for creation and recovery only.
