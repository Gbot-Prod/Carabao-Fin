# Carabao subdomains

How the web app is split across hosts, what each service needs, how to run it locally, and how to test it.

If you change a fact here in the code, update this file in the same change.

---

## 1. Architecture

| Host | Service | `APP_SURFACE` | Serves |
|---|---|---|---|
| `carabao.online` | web | `public` | Buyer app |
| `merchant.carabao.online` | web (same deploy) | `public` | `/merchant/*` as clean URLs (`/`, `/routing/<id>`, `/onboarding`) |
| `help.carabao.online` | web (same deploy) | `public` | `/help/*` as clean URLs (`/`, `/contact`). No sign-in. |
| `admin.carabao.online` | web-admin (same repo, own deploy) | `admin` | `/admin/*` only |
| `api.carabao.online` | backend | — | FastAPI |

One code base (`frontend/carabao-app`) makes two deploys:

- **web** (`APP_SURFACE=public`): the apex, `merchant.` and `help.` hosts.
- **web-admin** (`APP_SURFACE=admin`): the `admin.` host.

Both deploys use the same Postgres database as the API.

### 1.1 Host routing (`proxy.ts`, rules in `lib/urls.ts`)

Public deploy:

| Request | Result |
|---|---|
| any host, `/admin` or `/admin/*` | 404 |
| any host, `/merchant/<digits>[/...]` (old shop link) | redirect to apex `/farms/<digits>` (comes before the next rule) |
| any host, `/merchantDashboard[/...]` | redirect to `merchant.` `/...` |
| any host, `/merchantOnboarding` (the mobile app opens this) | redirect to `merchant.` `/onboarding` |
| `/help?section=terms` / `privacy` / `contact` / `faq` | redirect to `/terms`, `/privacy`, `help.` `/contact`, `help.` `/` |
| apex, `/merchant/*` | redirect to `merchant.` (prefix removed) |
| apex, `/help/*` | redirect to `help.` (prefix removed) |
| `merchant.`, `/merchant/*` | redirect to the clean URL on the same host |
| `merchant.`, `/auth`, `/forgot-password`, `/reset-password`, `/email-verified`, `/two-factor*` | served as they are |
| `merchant.`, a buyer path (`/order`, `/orders`, `/cart`, `/checkout`, `/confirmation`, `/profile`, `/track`, `/landing`, `/farms`, `/terms`, `/privacy`) | redirect to the apex |
| `merchant.`, any other path `/x` | rewrite to `/merchant/x` |
| `help.`, `/help/*` | redirect to the clean URL |
| `help.`, a buyer or sign-in path | redirect to the apex |
| `help.`, any other path `/x` | rewrite to `/help/x` |

Admin deploy:

| Request | Result |
|---|---|
| `/admin/*` | served as it is |
| `/api/*`, `/two-factor*`, `/reset-password`, `/forgot-password` | served as they are (allow-list) |
| `/` | rewrite to `/admin/dashboard` |
| any other path `/x` | rewrite to `/admin/x` (404 if no such admin page) |

Rules that apply to both deploys:

- Files with a dot in the last path segment (images, `robots.txt`) and `/_next/*` are not routed.
- **The host rules apply only in subdomain mode.** Subdomain mode means that `NEXT_PUBLIC_APP_URL` is on `ROOT_DOMAIN`. If it is not (for example `localhost` or a `*.up.railway.app` domain), one host serves all paths, and the links are `/merchant/...` and `/help/...`. This prevents redirect loops when the config and the host do not agree.
- All redirects are 307. Change them to 308 only after the hosts are stable, because browsers keep 308.
- Prefetch requests also go through the proxy, so that a prefetch on `merchant.` is rewritten like the page itself.

### 1.2 Links between hosts

Use `lib/urls.ts`. Do not write a host in code.

| Function | Gives |
|---|---|
| `appUrl(path)` | buyer page (`https://carabao.online/order`, or `/order` on one host) |
| `merchantUrl(path)` | merchant page by its clean path (`merchantUrl("/routing/5")`) |
| `helpUrl(path)` | help page by its clean path |
| `adminUrl(path)` | admin page by its full path (`adminUrl("/admin/orders")`) |
| `signInPath(next?)` | `/auth` on the public deploy, `/admin/login` on the admin deploy |
| `resolveStoredLink(link)` | a stored notification path (`/merchantDashboard`, `/admin/orders`) to the correct URL |

A link from a merchant page to a buyer page goes to another origin. Use a full page load (`window.location.assign(appUrl(...))`) or a `<Link>` with the absolute URL. Do not use `router.push("/profile")` on `merchant.`.

The backend stores notification links as paths, and the mobile app reads them. **Do not change the stored values.** The web maps them when it shows them (`NotificationBell.tsx`).

### 1.3 Sign-in and cookies (`lib/auth.ts`)

| | Public deploy | Admin deploy |
|---|---|---|
| Cookie prefix | `carabao` | `carabao-admin` |
| Cookie domain | `ROOT_DOMAIN` (shared by apex and `merchant.`), only in subdomain mode | admin host only |
| Trusted origins | apex, `merchant.`, `BETTER_AUTH_TRUSTED_ORIGINS`, `FRONTEND_URL`, `RAILWAY_PUBLIC_DOMAIN`, mobile app | admin origin only |
| Sign-in methods | phone + password, email + password, Google, Facebook, mobile app | email + password only, then TOTP |
| Better Auth endpoints | all (except the admin plugin's) | allow-list: `/sign-in/email`, `/sign-out`, `/get-session`, `/token`, `/jwks`, `/two-factor/*`, `/request-password-reset`, `/reset-password*`, `/change-password`, session list/revoke, `/ok`, `/error`. All others: 404 |
| Who gets a session | everyone | admins only (403 `NOT_AN_ADMIN`) |
| JWT key table | `jwks` | `jwks_admin` |
| JWT issuer | `AUTH_JWT_ISSUER`, else `BETTER_AUTH_URL` | `AUTH_JWT_ISSUER` (required in production) |
| JWT claims added | `mfa`, `surface: "public"` | `mfa`, `surface: "admin"` |

In production the cookie names have the `__Secure-` prefix (for example `__Secure-carabao.session_token`).

The admin deploy never reads the `carabao.*` cookie. A session from the apex therefore gets the admin login page on `admin.`.

> **HARD REQUIREMENT: the admin deploy has its own `BETTER_AUTH_SECRET`.**
> Both deploys share one database. The admin JWT private keys in `jwks_admin` are encrypted with the admin secret (private-key encryption stays on). If the two secrets are the same, the public deploy can decrypt the admin keys and sign admin tokens. The admin secret also signs admin session cookies and encrypts admin TOTP secrets.
> Never set the same value on both deploys. Never turn on `disablePrivateKeyEncryption`.

Results of the separate secret:

- An admin's TOTP secret can be read only by the admin deploy. An admin account therefore cannot complete sign-in on the public site. Use a separate account to buy or sell.
- The 2FA setup link (`/two-factor/enrol`) opens on the admin site (`ADMIN_URL` in the API).

### 1.4 API tokens (`backend/app/core/security.py`)

1. The API reads the token's `kid`.
2. It looks for the `kid` in the public key set (`PUBLIC_JWKS_URL`), then in the admin key set (`ADMIN_JWKS_URL`).
3. The set that has the key gives the **surface**. Nothing in the request can set it.
4. If the token has a `surface` claim that does not agree with that set, the API returns 401.
5. `_require_admin` (all `/admin/*` routes) and admin order chat need surface `admin` **and** an admin user with 2FA and `mfa=true`.

| Token | `/admin/*` |
|---|---|
| public key, any user | 403 "Use the admin site to do this." |
| admin key, non-admin user | 403 "Admin only" |
| public key with `surface: "admin"` | 401 |
| admin key with `surface: "public"` | 401 |
| admin key, admin, 2FA, `mfa=true` | 200 |

Key sets are kept 1 hour. An unknown `kid` makes the API fetch the set again, at most once in 30 s per set. If the admin key set cannot be reached, only admin tokens fail (503). Public tokens continue to work.

`ADMIN_JWKS_URL` must not go through Cloudflare Access. In production, use the Railway private network: `http://web-admin.railway.internal:<PORT>/api/auth/jwks`.

---

## 2. Environment variables

`NEXT_PUBLIC_*`, `ROOT_DOMAIN` and `APP_SURFACE` are fixed at build time. Set them before the build, and rebuild after a change.

Templates (placeholders only): `frontend/carabao-app/.env.example` and `backend/.env.example`. Never put a real value in these files.

### 2.1 web (public deploy)

| Name | Production value | Notes |
|---|---|---|
| `APP_SURFACE` | `public` | default |
| `ROOT_DOMAIN` | `carabao.online` | default |
| `NEXT_PUBLIC_APP_URL` | `https://carabao.online` | must be on `ROOT_DOMAIN` for subdomain mode |
| `NEXT_PUBLIC_MERCHANT_URL` | empty | default: `merchant.<ROOT_DOMAIN>` with the scheme and port of the app URL |
| `NEXT_PUBLIC_HELP_URL` | empty | default: `help.<ROOT_DOMAIN>` |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.carabao.online` | used for admin notification links |
| `BETTER_AUTH_URL` | `https://carabao.online` | Better Auth `baseURL` |
| `BETTER_AUTH_SECRET` | public secret | **different from web-admin** |
| `AUTH_JWT_ISSUER` | empty | default `BETTER_AUTH_URL` |
| `NEXT_PUBLIC_API_URL` | `https://api.carabao.online` | |
| `AUTH_SYNC_SHARED_SECRET` | same as API | web → API service calls (SMS, email) |
| Others | | as in `SYSTEM_REFERENCE.md` 4.2 (DB, OAuth, Mapbox, CSP) |

### 2.2 web-admin (admin deploy)

Same repo root (`frontend/carabao-app`), same build and start commands. Set:

| Name | Production value | Notes |
|---|---|---|
| `APP_SURFACE` | `admin` | |
| `ROOT_DOMAIN` | `carabao.online` | |
| `NEXT_PUBLIC_APP_URL` | `https://carabao.online` | links back to the buyer site |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.carabao.online` | |
| `BETTER_AUTH_URL` | `https://admin.carabao.online` | its own `baseURL` |
| `BETTER_AUTH_SECRET` | admin secret | **own value; hard requirement (1.3)** |
| `AUTH_JWT_ISSUER` | `https://carabao.online` | **required**: the production build and start fail without it |
| `NEXT_PUBLIC_API_URL` | `https://api.carabao.online` | |
| `AUTH_SYNC_SHARED_SECRET` | same as API | |
| `DATABASE_URL`, `PGSSL_*` | same DB | |
| OAuth keys | not set | no social sign-in on the admin site |

### 2.3 backend (API)

| Name | Production value | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://carabao.online,https://merchant.carabao.online,https://admin.carabao.online` | CORS, credentials on. Wildcard entries are dropped and logged. |
| `APP_URL` | `https://carabao.online` | PayMongo success / cancel pages. Fallback: first entry of `FRONTEND_URL`. |
| `ADMIN_URL` | `https://admin.carabao.online` | 2FA setup links (SMS, email, `make_admin.py`). Fallback: `APP_URL`. |
| `BETTER_AUTH_URL` | `https://carabao.online` | token issuer (or set `AUTH_JWT_ISSUER`) |
| `AUTH_JWT_ISSUER` | empty or `https://carabao.online` | must equal the web value |
| `PUBLIC_JWKS_URL` | empty | default `<issuer>/api/auth/jwks`. Old name `BETTER_AUTH_JWKS_URL` is still read. |
| `ADMIN_JWKS_URL` | `http://web-admin.railway.internal:<PORT>/api/auth/jwks` | empty = no admin tokens accepted |
| `AUTH_SYNC_SHARED_SECRET` | same as web | unchanged |
| `FRONTEND_URL` | empty | old name; read only as a fallback |

There is no `MERCHANT_URL`: the API makes no links to the merchant site.

### 2.4 Values that must stay in step

| Value | Place A | Place B |
|---|---|---|
| Token issuer | web and web-admin `AUTH_JWT_ISSUER` / web `BETTER_AUTH_URL` | API `AUTH_JWT_ISSUER` or `BETTER_AUTH_URL` |
| Admin key table `jwks_admin` | `lib/auth.ts` | `scripts/better-auth-migrate.mjs`, `backend/alembic/env.py` `EXCLUDED_TABLES` |
| Admin JWKS | web-admin `/api/auth/jwks` | API `ADMIN_JWKS_URL` |
| Origins | web hosts | API `ALLOWED_ORIGINS` |
| Admin site URL | web `NEXT_PUBLIC_ADMIN_URL` | API `ADMIN_URL` |

---

## 3. Database

`npm run auth:migrate:apply` (in `frontend/carabao-app`) now also creates the `jwks_admin` table. This is a second pass with only the admin JWT plugin. It only adds tables and columns. It does not change existing tables.

Run it before the first start of web-admin. Alembic ignores `jwks`, `jwks_admin` and `twoFactor`.

---

## 4. Admin accounts

The admin site signs in with email + password only. An admin needs a verified email.

```
cd backend
# promote an existing account (verified mobile number or email)
uv run python scripts/make_admin.py admin@example.com
# create an email + password account and promote it (asks for the password twice, 12+ characters)
uv run python scripts/make_admin.py --create --email admin@example.com --name "Admin Name"
```

The script:
- gives the admin role;
- clears old 2FA and ends the account's sessions;
- prints a one-time setup link on `ADMIN_URL` (24 h).

Each run writes an audit log row with the actor `system`.

Then:
1. Open `admin.<root>/admin/login` and sign in with the email and password.
2. Open the setup link, scan the QR code, enter the code, and keep the backup codes.
3. Sign out, then sign in again with the password and the code.

A phone-only account (phone signup, placeholder email) cannot sign in on the admin site. Add and verify an email first, or use `--create`.

Password reset on the admin site works by email only. The SMS reset endpoints are closed there, so the SMS option on `/forgot-password` gives an error.

---

## 5. Local setup

### 5.1 Hosts file

Add these lines to the hosts file (Windows: `C:\Windows\System32\drivers\etc\hosts`, as administrator; macOS/Linux: `/etc/hosts`):

```
127.0.0.1  carabao.test
127.0.0.1  merchant.carabao.test
127.0.0.1  help.carabao.test
127.0.0.1  admin.carabao.test
```

### 5.2 Env files

1. Copy `frontend/carabao-app/.env.example` to `.env.local`. Keep `ROOT_DOMAIN=carabao.test`, `NEXT_PUBLIC_APP_URL=http://carabao.test:3000` and `BETTER_AUTH_URL=http://carabao.test:3000`.
2. Make `frontend/carabao-app/.env.admin.local` (git-ignored) from the admin block at the end of `.env.example`. Use a **different** `BETTER_AUTH_SECRET`.
3. Copy `backend/.env.example` to `backend/.env`. Keep the `.test` origins and `ADMIN_JWKS_URL=http://localhost:3001/api/auth/jwks`.

### 5.3 Run

```
cd frontend/carabao-app
npm run auth:migrate:apply          # once: adds jwks_admin
npm run dev                         # public site, port 3000
npm run dev:admin                   # admin site, port 3001 (second terminal)

cd backend
uv run uvicorn main:app --reload --port 8000
```

Open:
- `http://carabao.test:3000`
- `http://merchant.carabao.test:3000`
- `http://help.carabao.test:3000`
- `http://admin.carabao.test:3001`

Notes:
- `dev:admin` uses its own build folder (`.next-admin`) and `tsconfig.admin.json`, so both dev servers can run at the same time.
- While `dev:admin` runs, Next.js changes the import line in `next-env.d.ts` to `.next-admin`. Do not commit that change.
- Without the hosts file, use `NEXT_PUBLIC_APP_URL=http://localhost:3000`. The site then runs on one host, and the subdomain checks below do not apply.

---

## 6. Manual test checklist

Automatic checks: `npm test`, `npm run lint` and `npm run build` in `frontend/carabao-app`; `uv run pytest` in `backend`.

| # | Do | Expected |
|---|---|---|
| 1 | Sign in on `carabao.test:3000`, then open `merchant.carabao.test:3000` | signed in on both (cookie `carabao.session_token`, domain `carabao.test`) |
| 2 | With that session, open `admin.carabao.test:3001` | admin login page |
| 3 | With a public token, call `GET /admin/stats` on the API | 403 "Use the admin site to do this." |
| 4 | Open `carabao.test:3000/admin/dashboard` | 404 |
| 5 | Open `merchant.carabao.test:3000/merchant/routing/5` | redirect to `merchant.carabao.test:3000/routing/5` |
| 6 | Open `carabao.test:3000/merchant/42` | redirect to `/farms/42` (shop page) |
| 7 | Open `carabao.test:3000/merchantOnboarding` (mobile link) | redirect to `merchant.carabao.test:3000/onboarding` |
| 8 | Open `carabao.test:3000/help?section=terms` | redirect to `/terms` |
| 9 | Open `help.carabao.test:3000/` signed out | FAQ, no sign-in asked |
| 10 | On the admin site, sign in with a non-admin email account | "This account is not an admin account." and no session |
| 11 | On the admin site, call `POST /api/auth/sign-in/social` or `/api/auth/sign-up/email` | 404 |
| 12 | Admin: sign in on the admin site with password, then TOTP | dashboard. API calls work (token from `jwks_admin`). |
| 13 | Merchant: from the dashboard click "View Shop", "Back to Profile", and a shipment "Routing" link | apex shop page, apex profile, `merchant.` routing page |
| 14 | Open a notification that links to `/merchantDashboard` | opens `merchant.` dashboard |
| 15 | Run the hardcoded-host grep (below) | only the localhost fallbacks |

Hardcoded-host grep:

```
grep -rnE "localhost:3000|localhost:8000|carabao\.online|up\.railway\.app|vercel\.app" \
  frontend/carabao-app backend --include=*.ts --include=*.tsx --include=*.js --include=*.mjs --include=*.py \
  | grep -vE "node_modules|\.next|\.venv|__pycache__"
```

Expected: only the dev fallbacks (`localhost`) and the `carabao.online` default for `ROOT_DOMAIN`.

---

## 7. Deploy (Railway)

1. Back up the DB. Run `npm run auth:migrate:apply` against it (adds `jwks_admin`).
2. Make a new secret for web-admin (`BETTER_AUTH_SECRET`). Do not copy the web value.
3. Make the web-admin service: same repo, root `frontend/carabao-app`, `npm ci && npm run build`, `npm run start`, with the vars in 2.2.
4. Custom domains:
   - web: `carabao.online`, `merchant.carabao.online`, `help.carabao.online`
   - web-admin: `admin.carabao.online`
   - API: `api.carabao.online`
5. Put Cloudflare Access in front of `admin.carabao.online` only.
6. API: set `ALLOWED_ORIGINS`, `APP_URL`, `ADMIN_URL`, and `ADMIN_JWKS_URL` (private network URL), then restart.
7. Set web vars (2.1), then rebuild web (the `NEXT_PUBLIC_*` values are fixed at build).
8. OAuth redirect URIs stay on the apex (`https://carabao.online/api/auth/callback/...`).
9. Do the checklist in section 6 on the real hosts.
