# Plan: one database login per service

Status: **draft.** Written 2026-11-21, rewritten 2026-11-22. Step 0 passed 2026-11-22. Decisions in section 9 are settled. Open checks were resolved from the Better Auth 1.7.26 source. Admin accounts move to invite-only with an out-of-band code (section 2), shipped before the database change (section 8, step 2). In-place migration chosen (section 8).

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

**Fallback:** if the ownership loop hits something unexpected during the fork rehearsal (step 3), wipe and rebuild instead. The data allows it today. Back up first (step 4) either way.

0. **Check first** ✅ **Passed 2026-11-22.** Railway Postgres (`pgssl:17`), server 17.11 (Debian 17.11-1.pgdg13+2). Session user `postgres` has `rolsuper`, `rolcreaterole`, `rolcreatedb` and `rolbypassrls`, so `CREATE ROLE`, `ALTER TABLE ... OWNER`, RLS, triggers and `SECURITY DEFINER` functions are all available. Local Docker `postgres:17` matches the major version.
1. Ship the `lib/auth.ts` public-site change (section 5) and confirm the admin-refused message still works.
2. Ship the admin-account changes (section 2, section 5) on today's single login. Run the backend tests and the manual checklist (section 7): invite, accept, TOTP setup, reset, deactivate, reactivate, `make_admin.py --create` and `--recover`. Existing admins keep working; they are already admins with TOTP. Update `Admin creation.md`.
3. Rehearse on a Railway fork of the database: run steps 5–8 there against copies of the services.
4. Back up the production database.
5. As the superuser, run `roles.sql`, then `guards.sql`. Nothing uses the new logins yet, so nothing changes.
6. Switch the API's `DATABASE_URL` to `carabao_api` and restart. Smoke-test invite, deactivate, reactivate and 2FA reset.
7. Switch web-admin to `carabao_web_admin`. Test invite acceptance, sign-in, TOTP setup, the redirect to `/two-factor/enrol` after a reset, and API calls.
8. Switch web to `carabao_web_public`. Test buyer sign-up, sign-in, reset, Google sign-in and the admin-refused message.
9. Set `carabao_owner` to `NOLOGIN` between migrations, or keep its URL out of every service. Leave `postgres` enabled (section 1). Check that no service still references `${{Postgres.DATABASE_URL}}` or another variable that resolves to the `postgres` login; each service's `DATABASE_URL` must be its own role URL.

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
