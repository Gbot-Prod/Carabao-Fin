# Admin accounts

This manual tells you how to make, monitor, reset and remove Carabao admin accounts. Updated 2026-11-25: **Reset account** replaces **Reset 2-step** and **Send new setup link**. It also resets the password.

Contents:

1. Rules
2. Monitor admin accounts
3. Make the first admin (`make_admin.py --create`)
4. Invite an admin
5. Admin profile and password change
6. Admin account reset (lost authenticator or forgotten password)
7. Deactivate and reactivate
8. Recovery (`make_admin.py --recover`)
9. Start again from an empty database

## 1. Rules

- An admin account is made only as an admin account. Nobody is promoted. A buyer or merchant account never becomes an admin.
- Admin accounts and buyer accounts never share an email. An invite to an email that has a Carabao account is refused.
- The public site (`carabao.`, `merchant.`) refuses admin accounts. The admin site (`admin.`) refuses all other accounts.
- On the admin site, an admin signs in with email + password, then a TOTP code. Only a session that passed the TOTP step can open the admin pages and call the admin API.
- Every admin-account change goes through the API. The API writes an audit row for each change.
- An admin cannot deactivate or reset their own account. An admin cannot turn off their own 2FA.
- There is only one way into an admin account: the invite (link + code + new password + TOTP). A reset and a reactivation send a new invite.
- Admin accounts are not deleted and not suspended. To remove access, use **Deactivate**.
- The admin site is behind Cloudflare Access. Each admin's email must be on the Access allow list, or the admin cannot open the site or the invite link.

## 2. Monitor admin accounts

### 2.1 Users page (`admin.<root>/admin/users`)

The **Role** column shows **Admin** and one of these states for each admin account:

| State | Meaning | Actions on the page |
|---|---|---|
| Invite pending | Invited, reset or reactivated. The admin has not set a password yet. | Resend invite, Deactivate |
| 2-step: not set up | Has a password. TOTP is not set up (the admin did not complete setup). | Reset account, Deactivate |
| 2-step: on | Can sign in with password + TOTP. | Reset account, Deactivate |
| Deactivated | Cannot sign in. History is kept. | Reactivate |

Only an admin in the **2-step: on** state counts as an active admin. The API refuses to deactivate the last active admin.

### 2.2 Audit log (`admin.<root>/admin/audit-log`)

Use the **Action** filter to see one type of event. Rows cannot be changed or deleted.

| Action (filter label) | Written when |
|---|---|
| `admin.create` (Admin created (script)) | `make_admin.py --create` ran. Actor `system`. |
| `admin.invite` (Admin invited) | An admin sent an invite. |
| `admin.invite_resent` (Admin invite resent) | An admin pressed **Resend invite**. |
| `admin.invite_locked` (Admin invite locked) | The 5th wrong invite code. The link and code stop working. |
| `admin.invite_accepted` (Admin invite accepted) | The invitee set a password. |
| `admin.two_factor_enrolled` (Admin two-step set up) | TOTP setup is complete. Written only if the database shows 2FA on. |
| `admin.account_reset` (Admin account reset) | An admin pushed **Reset account**. |
| `user.two_factor_reset` (Two-step reset) | Not written any more. Old rows only. |
| `admin.deactivate` (Admin deactivated) | An admin was deactivated. |
| `admin.reactivate` (Admin reactivated) | An admin was reactivated. |
| `admin.recover` (Admin recovered (script)) | `make_admin.py --recover` ran. Actor `system`. |
| `user.role_change` (Role change) | Not written any more. Old rows only. |

**Not in the audit log:** sign-ins, sign-outs, password changes and name changes on the profile page. Better Auth does these on the admin site, and only the API writes audit rows. To examine them, use the Admin Web service logs on Railway, and the `session` table (as the superuser).

### 2.3 Check often

- An **Invite pending** account that is older than 24 hours has an expired invite. Resend it, or deactivate the account.
- An account in **2-step: not set up** for a long time did not complete setup. Reset the account, or deactivate it.
- An `admin.invite_locked` row means that someone typed 5 wrong codes. Speak to the invitee before you resend.
- Every admin account must belong to a person that you know. Deactivate an account that nobody claims.

## 3. Make the first admin (`make_admin.py --create`)

Use this only when no admin exists (a new or empty database), or when no admin can sign in. All other admins are invited (section 4).

1. Open a shell in the API service: `railway ssh` on the **Carabao Backend** service. The script connects as `carabao_api`, which has the permissions it needs.
2. Run the script. It asks for the password two times (12+ characters, upper and lower case, a number and a symbol). The password is never an argument, so it is not in the shell history.

   ```sh
   cd backend   # skip if the shell already starts in the backend folder
   uv run python scripts/make_admin.py --create --email admin@example.com --name "Admin Name"
   ```

   The script refuses an email that has a Carabao account. It makes the admin with a verified email and a password, writes `admin.create` (actor `system`) and prints a one-time setup link on `ADMIN_URL`. The link is valid for 24 hours.
3. Make sure that the email is on the Cloudflare Access allow list for the admin host.
4. Open `admin.<root>/admin/login`. Sign in with the email and password. The site sends you to the setup page.
5. Open the printed setup link (`/two-factor/enrol?token=…`). Type the password again, scan the QR code, enter the code, and keep the backup codes in a safe place.
6. Sign out. Sign in again with password + TOTP. You see the dashboard.

**`ADMIN_JWKS_THUMBPRINTS`.** The API accepts admin tokens only from the keys listed in this variable. You must update it only when the `jwks_admin` table has a new key (a new database, or a key rotation). A wipe that keeps `jwks_admin` (section 9) does not need it. To update it: after the first admin sign-in, run `uv run python scripts/admin_jwk_thumbprints.py` **from your computer**, with `DATABASE_URL`, `PGSSL_CA` and `PGSSL_SERVERNAME` set to the superuser's Railway values. Do not run it in the API shell: `carabao_api` cannot read `jwks_admin`. Make sure that web-admin made every listed key. Put the output in the API's `ADMIN_JWKS_THUMBPRINTS`, then restart the API. Until you do this, the admin site lets you sign in, but its API calls return 401.

## 4. Invite an admin

An invited admin needs three things: the **link** (sent by email), the **code** (you give it to them) and an **authenticator app**.

### 4.1 Send the invite

1. Sign in on the admin site with password + TOTP.
2. Open **Users**. Push **Invite admin**.
3. Enter the name and the email. The email must not have a Carabao account.
4. Push **Send invite**. The API makes the account (role admin, no password), emails the link `admin.<root>/admin/invite?invite=…&token=…`, and shows you an 8-character code (`XXXX-XXXX`) **one time only**.
5. Give the code to the new admin yourself: in person, or on a different channel that you both trust. Do not send the code in the same email or chat as the link. Only a hash of the code is kept, so nobody can show it again.
6. Add the email to the Cloudflare Access allow list.

The link and the code are both valid for 24 hours.

### 4.2 Accept the invite (the new admin does this)

1. Open the link from the email.
2. Enter the code and a new password two times.
3. The site opens the admin sign-in page with the email filled in. Sign in with the password.
4. The site opens the TOTP setup page (the link's token comes with it). Type the password again, scan the QR code, enter the code and keep the backup codes.
5. Sign out. Sign in again with password + TOTP.

If the link, the token or the code is wrong or expired, the page always shows the same message: "This invite link or code is not valid. Ask an admin to send a new invite." The message does not tell which part is wrong.

### 4.3 Resend, expiry and lock

- **Resend invite** (Users page, only while the state is **Invite pending**): sends a new link and shows a new code. The old link and code stop working immediately.
- **Expiry:** after 24 hours the link and code stop working. Use **Resend invite**.
- **Lock:** the 5th wrong code deletes the code and the setup token, and writes `admin.invite_locked`. Use **Resend invite**. A guess with a wrong link token does not count, so a person who knows only the invite id cannot lock the invite.
- After the invitee sets a password, **Resend invite** is refused. Use **Reset account** if TOTP setup is not complete.

## 5. Admin profile and password change

### 5.1 Profile page (`admin.<root>/admin/profile`)

Open **Profile** in the **Account** group of the sidebar. The page shows your name, email, role, 2FA state, the date the account was made, and the start time of this session. You can change two things only:

- **Display name** (1 to 100 characters). Other admins see it on the Users page and in the audit log.
- **Password** (section 5.2).

You cannot change your email, turn off 2FA or see your TOTP secret on this page. For a lost authenticator or a forgotten password, see section 6.

Both changes need a session that passed the TOTP step. The server refuses all other fields on the name change (only `name`). The database (guard G1) also refuses role, ban and 2FA-off changes from the admin site.

### 5.2 Change the password

1. On **Profile**, under **Password**, enter the current password.
2. Enter the new password two times. Rule: 12 to 128 characters, with an uppercase letter, a lowercase letter, a number and a symbol. It must be different from the current password.
3. Push **Change password**.
4. Your other sessions end. This session stays open. 2FA does not change: your authenticator continues to work.

### 5.3 Forgotten password

The admin site has no **Forgot password?** link. The `/forgot-password` and `/reset-password` pages and the Better Auth reset endpoints are closed on the admin host. An admin who forgot the password asks another admin for an account reset (section 6).

On the public site, a reset request for an admin email or number gives the usual answer ("If this email exists…") and sends nothing. This keeps the public site from telling that an address belongs to an admin.

Only one endpoint can set a password: invite acceptance (`POST /admin/invites/accept`). It refuses an account that has a password. A reset first deletes the password, then sends a new invite.

## 6. Admin account reset (lost authenticator or forgotten password)

Use this when an admin lost their authenticator, forgot their password, or did not complete TOTP setup. Another admin does it. You cannot reset your own account.

1. Before you start, confirm the identity of the person outside the system (in person or by a known phone number).
2. On **Users**, find the admin (state **2-step: on** or **2-step: not set up**). Push **Reset account** and confirm.
3. The API deletes the admin's password, TOTP, backup codes, trusted devices, any open link or code, and all sessions. It emails a new invite link (24 hours) and shows you a new 8-character code **one time only**. It writes `admin.account_reset`. The state changes to **Invite pending**.
4. Give the code to the admin as in section 4.1, step 5.
5. The admin does section 4.2: open the link, enter the code and a new password, sign in, and set up TOTP again.

Rules:

- Reset is refused for yourself, for an admin with **Invite pending** (use **Resend invite**), and for a **Deactivated** admin (use **Reactivate**, which also resets the account).
- If the code is lost or the link expires, use **Resend invite**.
- The database lets the API delete only the password row of an admin account (`guards.sql`, policy `api_delete_admin_password`). The API cannot delete or change a buyer or merchant password.
- If no admin can sign in to do the reset, use `make_admin.py --recover` (section 8).

## 7. Deactivate and reactivate

**Deactivate** removes an admin's access:

1. On **Users**, push **Deactivate** for the admin and confirm.
2. The account keeps the admin role. Sign-in is blocked, all sessions end, 2FA is removed, and any open invite code is deleted. History and audit rows stay. The API writes `admin.deactivate`.
3. Also remove the email from the Cloudflare Access allow list.

Deactivate is refused for yourself and for the last active admin (section 2.1).

**Reactivate** gives access again:

- The API deletes any old password and 2FA, and sends a new invite: a new link by email and a new code, which the page shows to you one time. Give the code as in section 4.1, step 5. The admin then does section 4.2.
- The API writes `admin.reactivate`.

## 8. Recovery (`make_admin.py --recover`)

Use this only when no admin can sign in. It works only on an existing **admin** account. It refuses all other accounts.

```sh
cd backend
uv run python scripts/make_admin.py --recover admin@example.com
```

Run it in the API shell (`railway ssh`, Carabao Backend). It removes 2FA, any deactivation and all sessions, then prints a new setup link (24 hours). If the account has no password (it never accepted its invite), it also asks for a password. It does not change a password that exists. It writes `admin.recover` (actor `system`). Then do section 3, steps 4–6.

### 8.1 Forgotten admin password

If another admin can sign in, use **Reset account** (section 6). You do not need the database.

Use the procedure below only when no admin can sign in and the admin also forgot the password. The operator does it, after confirming the identity of the person outside the system. `make_admin.py --recover` does not delete a password, so the old password row is first deleted as the superuser.

1. Open psql as the superuser (the Postgres service's `DATABASE_PUBLIC_URL`). Delete the admin's password row only:

   ```sql
   BEGIN;
   DELETE FROM account
   WHERE "providerId" = 'credential'
     AND "userId" = (SELECT id FROM "user" WHERE email = 'admin@example.com' AND role = 'admin');
   -- Expect: DELETE 1. If the count is not 1, run ROLLBACK and stop.
   COMMIT;
   ```

2. In the API shell, run `make_admin.py --recover admin@example.com`. The account now has no password, so the script asks for a new one (12+ characters, two times). It also removes 2FA and all sessions, and prints a new setup link.
3. Give the password and the link to the admin by two different channels.
4. The admin signs in, sets up TOTP again with the link, then signs out and signs in with password + TOTP.
5. Ask the admin to change the password on **Profile** (section 5.2), so that only the admin knows it.

The audit log shows `admin.recover` (with `password_set: yes`) and then `admin.two_factor_enrolled`.

## 9. Start again from an empty database

Use this to remove all accounts and data from production and test again from zero. On 2026-11-22 production holds test data only, so this is permitted. **Do not do this when real users exist.**

The schema, the database logins, the grants and the guards stay. Only rows are removed. You do not run migrations or `roles.sql` again.

### 9.1 What stays and what goes

| Kept | Why |
|---|---|
| `alembic_version` | The schema version. `truncate_db.py` always keeps it. |
| `jwks`, `jwks_admin` | The token signing keys. If you keep them, all tokens stay valid, and `ADMIN_JWKS_THUMBPRINTS` does not change. If you delete `jwks_admin`, you must update `ADMIN_JWKS_THUMBPRINTS` (section 3). |
| `reference_prices` | Seed data (sample prices). Optional: remove `--keep reference_prices` to delete it, then load it again with `scripts/load_reference_prices.py`. |

All other tables are emptied: users, sessions, passwords, 2FA, merchants, orders, payouts, audit log and the rest. Everybody is signed out.

### 9.2 Procedure

1. **Back up** (recommended). Railway > Postgres > Backups > Create backup. Optionally also run `powershell -ExecutionPolicy Bypass -File backend\db\backup.ps1`.
2. **Set the superuser connection** in a PowerShell window, from the `backend` folder. The `carabao_api` login cannot empty tables (it has no TRUNCATE permission), and `carabao_owner` is `NOLOGIN`. So use the Postgres service's `DATABASE_PUBLIC_URL`. The TLS values are on the Carabao Backend service (`PGSSL_CA`, `PGSSL_SERVERNAME`). These variables override `backend/.env`, which points to the local Docker database.

   `PGSSL_CA` is a certificate on many lines, and `Read-Host` reads one line only. So first copy its value into a file outside the repo, for example `%USERPROFILE%\carabao-backups\railway-ca.pem`. (It is a public CA certificate, not a secret.)

   ```powershell
   cd backend
   $env:DATABASE_URL     = Read-Host "Postgres DATABASE_PUBLIC_URL" -MaskInput
   $env:PGSSL_CA         = Get-Content "$env:USERPROFILE\carabao-backups\railway-ca.pem" -Raw
   $env:PGSSL_SERVERNAME = Read-Host "PGSSL_SERVERNAME (from Carabao Backend)"
   ```

3. **Dry run.** Make sure that the target is the Railway host and that the KEEP list is correct.

   ```powershell
   uv run python scripts/truncate_db.py --keep jwks --keep jwks_admin --keep reference_prices
   ```

4. **Wipe.** Use the database name that the dry run printed (usually `railway`). It is one transaction: if a step fails, nothing changes.

   ```powershell
   uv run python scripts/truncate_db.py --keep jwks --keep jwks_admin --keep reference_prices --yes --confirm railway
   ```

5. **Remove the variables** from the window:

   ```powershell
   Remove-Item Env:DATABASE_URL, Env:PGSSL_CA, Env:PGSSL_SERVERNAME
   ```

6. **Check the guards.** Run `powershell -ExecutionPolicy Bypass -File backend\db\apply_roles.ps1` (no `-SetPasswords`). All 14 checks must be ok. A wipe does not change the logins or the guards, so this run changes nothing.
7. **Make the first admin** (section 3). Do not update `ADMIN_JWKS_THUMBPRINTS`: `jwks_admin` was kept.
8. **Do the test round** (section 9.3).

### 9.3 Test round after a wipe

Do the tests in this order. Write the result of each one in [SUBDOMAINS.md](SUBDOMAINS.md) section 6 (rows 10, 12, 16–28).

1. First admin: `--create`, sign-in, TOTP setup, sign-in with password + TOTP. Audit log shows `admin.create` and `admin.two_factor_enrolled`.
2. Admin site: sign-in with a buyer account is refused (row 10). Dashboard and API calls work (row 12).
3. Invite: email that has an account is refused; wrong code 4 times, then the right code; setup; sign-in (rows 16–20).
4. Invite lock and resend (row 21).
5. Account reset (row 22).
6. Deactivate, sign-in refused, reactivate (rows 23–24). Refusals for yourself and for suspension (row 25).
7. Admin profile: change the name and the password; the admin site has no **Forgot password?** link (row 26).
8. Public site: buyer sign-up by phone, sign-in, SMS password reset, Google sign-in. An admin email is refused, and a reset for an admin email sends nothing (rows 27–28).
9. `make_admin.py --recover` on an admin, and on a buyer (refused).
10. Look at the Backend, Admin Web, Web Application and Postgres logs. There must be no `permission denied`, `InsufficientPrivilege` or 500 errors.
