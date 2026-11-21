There are two paths. The first admin is made by a server-side script, and every admin after that is promoted by an existing admin from the admin site.

First admin, via the make_admin.py script
Run it in the API service shell (in production, as the last deploy step):


cd backend
# promote an existing account (verified email, or verified mobile)
uv run python scripts/make_admin.py admin@example.com
# or create a fresh email + password account (asks for the password twice, 12+ chars)
uv run python scripts/make_admin.py --create --email admin@example.com --name "Admin Name"
The script:

gives the account the admin role;
turns off any old 2FA and ends all of the account's sessions;
writes an audit row with the actor system;
prints a one-time setup link on ADMIN_URL, valid for 24 hours. It does not send it.
Then:

Sign in at admin.<root>/admin/login with email and password.
Open the setup link (/two-factor/enrol?token=...). Scan the QR code, enter the code and save the backup codes.
Sign out, then sign in again with password + TOTP. The admin area only accepts a session with mfa=true.
Only on a fresh deploy, after that first sign-in: run uv run python scripts/admin_jwk_thumbprints.py. Check that every key it lists was made by web-admin, put the output in the API's ADMIN_JWKS_THUMBPRINTS, then restart the API. Until you do, the admin site lets you sign in but its API calls return 401 (SUBDOMAINS.md:508).

Other admins, promoted by an existing admin
The person signs up normally. They must have a verified email, because the admin site is email + password only. A phone-only account can't sign in there, so they need to add and verify an email first.
An existing admin promotes them from the admin users page. That calls PATCH /admin/users/{id}/role with { is_admin: true } (admin.ts:242).
The API creates the 24-hour setup token and sends the link by SMS and email to the person's verified contacts. It returns 502 if both fail.
The new admin does the same steps 1–3 as above: sign in, enrol TOTP through the link, then sign in again with the code.
Related
Recovery (no admin can sign in): run make_admin.py <verified email/number> again, then do the sign-in and enrol steps.
Expired or used link: an existing admin can resend or reset 2FA, or you can re-run make_admin.py.
Admins can't turn off their own 2FA. Another admin has to reset it.