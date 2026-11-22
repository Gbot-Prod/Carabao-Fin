# Admin creation

Admin accounts are made only as admin accounts. Nobody is promoted: a buyer or merchant account never becomes an admin, and admin and buyer accounts never share an email. There are two ways to make one:

- **Invite** (normal): an existing admin invites the new admin from the admin site.
- **`make_admin.py --create`** (first admin only, or when no admin can sign in): a script in the API service shell.

Background and the full rules: [DB_ROLE_SPLIT_PLAN.md](DB_ROLE_SPLIT_PLAN.md) section 2.

## Invite (every admin after the first)

Becoming an admin takes three things: the **link** (sent by email), the **code** (handed over by the inviting admin) and an **authenticator app**.

1. **Invite.** On the admin site, open **Users** and press **Invite admin**. Enter the new admin's name and an email that has no Carabao account yet. You need a session that passed the TOTP step.
   - The API makes the account (role admin, no password yet), emails the link `admin.<root>/admin/invite?invite=…&token=…` and shows you an 8-character code (`XXXX-XXXX`) **once**.
   - Give the code to the new admin yourself, in person or over a channel you both trust. Don't send it in the same email or chat as the link. Only its hash is stored, so it can't be shown again.
   - The link and the code both last 24 hours.
2. **Accept.** The new admin opens the link, enters the code and chooses a password (12+ characters, with upper and lower case, a number and a symbol). The 5th wrong code ends the invite; then you press **Resend invite**.
   - The admin site is behind Cloudflare Access: the new admin's email must be allowed there too, or they can't open the link.
3. **Set up TOTP.** The page sends them to the admin sign-in. After signing in with email and password, they land on the setup page (the link's token comes along). They type the password again, scan the QR code, enter the code and keep the backup codes.
4. **Sign in for real.** Sign out, then sign in with password + code. Only that session reaches the admin area and the API.

**Resend invite** (on the Users page, only while the invite is not accepted): a new link and a new code. The old ones stop working.

Every step is in the audit log: `admin.invite`, `admin.invite_resent`, `admin.invite_locked`, `admin.invite_accepted`, `admin.two_factor_enrolled`.

## First admin: `make_admin.py --create`

Run it in the API service shell (in production, as the last deploy step). It asks for the password twice; the password is never an argument, so it isn't in the shell history.

```sh
cd backend
uv run python scripts/make_admin.py --create --email admin@example.com --name "Admin Name"
```

It refuses an email that already has any Carabao account. It makes the admin with a verified email and password, writes an audit row (`admin.create`, actor `system`) and prints a one-time setup link on `ADMIN_URL`, valid for 24 hours. There is no code: you are the one at the shell. Then:

1. Sign in at `admin.<root>/admin/login` with the email and password. You are sent to the setup page.
2. Open the printed setup link (`/two-factor/enrol?token=…`). Scan the QR code, enter the code and save the backup codes.
3. Sign out, then sign in again with password + TOTP.

Only on a fresh deploy, after that first sign-in: run `uv run python scripts/admin_jwk_thumbprints.py`. Once the database logins are split (SUBDOMAINS.md 3.1), the API's own login (`carabao_api`) cannot read `jwks_admin`, so run it from your machine with `DATABASE_URL` set to the Postgres superuser's public URL, not in the API service shell. Check that every key it lists was made by web-admin, put the output in the API's `ADMIN_JWKS_THUMBPRINTS`, then restart the API. Until you do, the admin site lets you sign in but its API calls return 401 (SUBDOMAINS.md section 7).

## Lost authenticator: Reset 2-step

Another admin presses **Reset 2-step** on the Users page. The admin's TOTP, trusted devices and sessions are cleared, and a new 24-hour setup link goes to their verified number and email. When they next sign in with email + password, they are sent to the setup page; setup still needs that link. No code is involved.

Reset is refused for yourself, for an admin who hasn't accepted the invite yet (use **Resend invite**), and for a deactivated admin (reactivate first). Admins can't turn off their own 2FA.

## Removing an admin: Deactivate

Admin accounts are never deleted or suspended. **Deactivate** keeps the role, blocks sign-in, ends every session and clears 2FA. History and audit rows stay. It is refused for yourself and for the last admin who can sign in.

**Reactivate** lets them back in: an admin with a password gets a new 2FA setup link; one who never accepted the invite gets a fresh invite (a new link and a new code shown to you).

## Recovery: `make_admin.py --recover`

When no admin can sign in. For an existing **admin** account only; any other account is refused.

```sh
cd backend
uv run python scripts/make_admin.py --recover admin@example.com
```

It clears 2FA, any deactivation and all sessions, then prints a new setup link. If the account never accepted its invite, it also asks for a password. Audit row `admin.recover`, actor `system`. Then do the sign-in and setup steps above.
