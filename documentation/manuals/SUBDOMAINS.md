# Carabao subdomains

How the web app is split across hosts, what each service needs, how to run it locally, and how to test it.

If you change a fact here in the code, update this file in the same change.

---

## 1. Architecture

| Host | Service | `APP_SURFACE` | Serves |
|---|---|---|---|
| `carabao.online` | web | `public` | Buyer app |
| `merchant.carabao.online` | web (same deploy) | `public` | `/merchant/*` as clean URLs (`/`, `/sales`, `/routing/<id>`, `/onboarding`, ...; see 1.5) |
| `help.carabao.online` | web-help (same repo, own deploy) | `help` | `/help/*` only, as clean URLs (`/`, `/contact`, `/terms`, `/privacy`). Static. No sign-in, no API, no database. |
| `admin.carabao.online` | web-admin (same repo, own deploy) | `admin` | `/admin/*` only |
| `api.carabao.online` | backend | — | FastAPI |

One code base (`frontend/carabao-app`) makes three deploys:

- **web** (`APP_SURFACE=public`): the apex and `merchant.` hosts. It can also serve `help.` (the public deploy keeps the help rules in 1.1).
- **web-admin** (`APP_SURFACE=admin`): the `admin.` host.
- **web-help** (`APP_SURFACE=help`): the `help.` host. It builds and runs with four variables only (2.4).

web and web-admin use the same Postgres database as the API. web-help uses no database.

Two root layouts:
- `app/(site)/layout.tsx`: all pages except help. It has the providers and `connection()` (CSP nonce), so these pages render per request.
- `app/(help)/layout.tsx`: help only. It is static and imports no auth, API or database code.

Unknown URLs use `app/global-not-found.tsx` (`experimental.globalNotFound`).

### 1.1 Host routing (`proxy.ts`, rules in `lib/urls.ts`)

Public deploy:

| Request | Result |
|---|---|
| any host, `/admin` or `/admin/*` | 404 |
| any host, `/merchant/<digits>[/...]` (old shop link) | redirect to apex `/farms/<digits>` (comes before the next rule) |
| any host, `/merchantDashboard[/...]` | redirect to `merchant.` `/...` |
| any host, `/merchantOnboarding` (the mobile app opens this) | redirect to `merchant.` `/onboarding` |
| `/help?section=terms` / `privacy` / `contact` / `faq` | redirect to `help.` `/terms`, `/privacy`, `/contact`, `/` |
| apex or `merchant.`, `/terms` or `/privacy` (old links; the pages moved) | redirect to `help.` `/terms` or `/privacy` |
| apex, `/merchant/*` | redirect to `merchant.` (prefix removed) |
| apex, `/help/*` | redirect to `help.` (prefix removed) |
| `merchant.`, `/merchant/*` | redirect to the clean URL on the same host |
| any host, `/merchant/login` (old merchant login) | redirect to `merchant.` `/auth` |
| `merchant.`, `/auth` | rewrite to `/merchant/auth` (the Merchant Centre login, not the buyer sign-in) |
| `merchant.`, `/login` (old merchant login) | redirect to `/auth` on the same host |
| `merchant.`, `/forgot-password`, `/reset-password`, `/email-verified`, `/two-factor*` | served as they are |
| `merchant.`, a buyer path (`/order`, `/orders`, `/saved`, `/notifications`, `/cart`, `/checkout`, `/confirmation`, `/profile`, `/track`, `/landing`, `/farms`, `/listings`; `BUYER_PREFIXES` in `lib/urls.ts`) | redirect to the apex |
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

Help deploy:

| Request | Result |
|---|---|
| `/help/*` | redirect to the clean URL |
| `/api`, `/api/*` | 404 |
| `/_next/*`, files with a dot in the last segment | served as they are |
| any other path `/x` | rewrite to `/help/x` (404 if no such help page) |

Rules that apply to all deploys:

- **`robots.txt` and `sitemap.xml` per host** (CF-0041): each host lists only its own pages. Apex: `/`, `/farms`, each public farm, each listing buyers can order (`/listings/{id}`, CF-0091) (and `/help/*` when not in subdomain mode). `help.` (help deploy, or `help.` on the public deploy): the four help pages, and its `robots.txt` names its own sitemap. `merchant.` and admin: empty sitemap, `robots.txt` blocks all.
- Asset files are not routed: a top-level name with a dot (`/icon.png`, `robots.txt`), anything under `/images/`, and `/_next/*`. A dot deeper in a path (`/farms/1.x`) does not count, so a dynamic page cannot skip the host rules (on the admin deploy it would render a buyer page).
- **The host rules apply only in subdomain mode.** Subdomain mode means that `NEXT_PUBLIC_APP_URL` is on `ROOT_DOMAIN`. If it is not (for example `localhost` or a `*.up.railway.app` domain), one host serves all paths, and the links are `/merchant/...` and `/help/...`. This prevents redirect loops when the config and the host do not agree.
- All redirects are 307. Change them to 308 only after the hosts are stable, because browsers keep 308.
- Prefetch requests also go through the proxy, so that a prefetch on `merchant.` is rewritten like the page itself.
- `/api/*` also goes through the proxy (so that the help deploy can refuse it). On web and web-admin, the proxy passes it on at once, with no CSP work.
- **CSP on help pages:** they are static, so they have no nonce, and Next.js puts inline scripts in them. For `/help/*` pages (on any deploy) the proxy sends `script-src 'self' 'unsafe-inline'`. The help deploy sends no CSP reports (it has no `/api/csp-report`). Help pages have no sign-in and no user data. All other pages keep the nonce policy.

### 1.2 Links between hosts

Use `lib/urls.ts`. Do not write a host in code.

| Function | Gives |
|---|---|
| `appUrl(path)` | buyer page (`https://carabao.online/order`, or `/order` on one host) |
| `merchantUrl(path)` | merchant page by its clean path (`merchantUrl("/routing/5")`) |
| `helpUrl(path)` | help page by its clean path |
| `adminUrl(path)` | admin page by its full path (`adminUrl("/admin/orders")`) |
| `signInPath(next?)` | `/auth` on the public deploy, `/admin/login` on the admin deploy |
| `signInPathFor({host, pathname}, next?)` / `signInPathHere(next?)` | **the sign-in page of the site you are on** (standard): buyer `/auth`, merchant `merchant.` `/auth` (`/merchant/auth` on one host), admin `/admin/login`. Logout, idle logout and the "back to sign in" links on shared pages (`/forgot-password`, `/reset-password`, `/two-factor`, via `useSignInPath()`) use it. |
| `resolveStoredLink(link)` | a stored notification path (`/merchantDashboard`, `/admin/orders`) to the correct URL. The bell first maps a plain `/merchantDashboard` by notification kind (`lib/merchant-links.ts`, 1.5). |

A link from a merchant page to a buyer page goes to another origin. Use a full page load (`window.location.assign(appUrl(...))`) or a `<Link>` with the absolute URL. Do not use `router.push("/profile")` on `merchant.`.

The backend stores notification links as paths, and the mobile app reads them. **Do not change the stored values.** The web maps them when it shows them (`NotificationBell.tsx`).

### 1.3 Sign-in and cookies (`lib/auth.ts`)

| | Public deploy | Admin deploy |
|---|---|---|
| Cookie prefix | `carabao` | `carabao-admin` |
| Cookie domain | `ROOT_DOMAIN` (shared by apex and `merchant.`), only in subdomain mode | admin host only |
| Trusted origins | apex, `merchant.`, `BETTER_AUTH_TRUSTED_ORIGINS`, `RAILWAY_PUBLIC_DOMAIN`, mobile app | admin origin only |
| Sign-in methods | phone + password, email + password, Google, Facebook, mobile app | email + password only, then TOTP |
| Better Auth endpoints | all (except the admin plugin's) | allow-list: `/sign-in/email`, `/sign-out`, `/get-session`, `/token`, `/jwks`, `/two-factor/*`, `/request-password-reset`, `/reset-password*`, `/change-password`, session list/revoke, `/ok`, `/error`. All others: 404 |
| Who gets a session | everyone except admins (403 `ADMIN_ACCOUNT`; a Google or Facebook sign-in goes to `/auth?error=admin_account`) | admins only (403 `NOT_AN_ADMIN`) |
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
- The public deploy also refuses every admin sign-in (`noAdminsOnPublicSurface` in `lib/auth.ts`), also before the admin sets up 2FA. A role change in the API (`better_auth_store.set_role`) deletes all sessions of that user, so a promoted user does not keep a buyer session.
- The 2FA setup link (`/two-factor/enrol`) opens on the admin site (`ADMIN_URL` in the API).

### 1.4 API tokens (`backend/app/core/security.py`)

1. The API reads the token's `kid`.
2. It looks for the `kid` in the public key set (`PUBLIC_JWKS_URL`), then in the admin key set (`ADMIN_JWKS_URL`). In the admin set it takes only a key whose RFC 7638 thumbprint is in `ADMIN_JWKS_THUMBPRINTS`. The admin deploy serves every row of `jwks_admin`, and the public deploy can write to that table (same database), so a planted key, also one that reuses a real `kid`, is refused and logged.
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


### 1.5 Merchant site pages (`app/(site)/(merchant)`)

The merchant pages do not use the buyer layout. `(merchant)/merchant/(shell)/layout.tsx` gives each page `MerchantShell` (a sidebar like the admin site) and `MerchantProvider` (it loads the performance, produce, shop page and orders once for all pages). The shell shows a gate when the user is signed out or has no merchant profile. Onboarding is outside the shell, because the user is not a merchant yet.

| Clean path | Page |
|---|---|
| `/` | Dashboard: stat cards, "needs your attention", revenue and order charts, recent orders |
| `/sales` | Orders. `?order=<id>` scrolls to one order. Not `/orders`: that is a buyer path and redirects to the apex (1.1). |
| `/shipments` | Orders ready to ship, make a route |
| `/routing/<id>` | One route (Shipments is active in the sidebar) |
| `/earnings` | Earnings, payout details, cash out |
| `/reviews` | Reviews |
| `/produce` | Produce listings |
| `/inventory` | Stock, stock alerts and threshold, demand insight |
| `/shop` | Public shop page (logo, banner, title) |
| `/vouchers` | Farm voucher codes: create, turn on/off, delete unused ones (CF-0061) |
| `/settings` | Store details (address, pickup pin, delivery days and price, contact number), delete merchant profile |
| `/onboarding` | Merchant application (no shell) |
| `/auth` | Merchant Centre login (no shell). Same accounts as the buyer site. Was `/login`, which now redirects here. |

A new merchant page must not have the name of a buyer path (1.1).

Notification links: the backend stores `/merchantDashboard` for all merchant notifications, and the mobile app reads it. Do not change it. The web bell opens a page by the notification kind: `new_order` and `chat_message` open `/sales`, `review_received` opens `/reviews`, `payout_released` and `payout_destination_changed` open `/earnings`. Other kinds open `/`.
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
| `APP_URL` | `https://carabao.online` | PayMongo success / cancel pages. |
| `ADMIN_URL` | `https://admin.carabao.online` | 2FA setup links (SMS, email, `make_admin.py`). Fallback: `APP_URL`. |
| `BETTER_AUTH_URL` | `https://carabao.online` | token issuer (or set `AUTH_JWT_ISSUER`) |
| `AUTH_JWT_ISSUER` | empty or `https://carabao.online` | must equal the web value |
| `PUBLIC_JWKS_URL` | empty | default `<issuer>/api/auth/jwks`. |
| `ADMIN_JWKS_URL` | `http://web-admin.railway.internal:<PORT>/api/auth/jwks` | empty = no admin tokens accepted |
| `ADMIN_JWKS_THUMBPRINTS` | output of `scripts/admin_jwk_thumbprints.py` | the admin keys the API trusts, comma separated. Empty = no admin tokens accepted (logged as an error). Add the new thumbprint **before** a new admin key is used. |
| `AUTH_SYNC_SHARED_SECRET` | same as web | unchanged |

There is no `MERCHANT_URL`: the API makes no links to the merchant site.

### 2.4 web-help (help deploy)

Same repo root and build/start commands. **Only these four variables** (the build was checked with no other app variable and no `.env` file):

| Name | Production value | Notes |
|---|---|---|
| `APP_SURFACE` | `help` | |
| `ROOT_DOMAIN` | `carabao.online` | |
| `NEXT_PUBLIC_APP_URL` | `https://help.carabao.online` | this deploy's own URL |
| `NEXT_PUBLIC_MAIN_URL` | `https://carabao.online` | links back to the apex and merchant onboarding |

Do not give web-help `DATABASE_URL`, `BETTER_AUTH_SECRET` or OAuth keys. It does not need them.

`lib/auth.ts` makes Better Auth (and its database pool) on first use, not at import. This is why the full app builds without a database URL. On web-help, that code never runs.

### 2.5 Values that must stay in step

| Value | Place A | Place B |
|---|---|---|
| Token issuer | web and web-admin `AUTH_JWT_ISSUER` / web `BETTER_AUTH_URL` | API `AUTH_JWT_ISSUER` or `BETTER_AUTH_URL` |
| Admin key table `jwks_admin` | `lib/auth.ts` | `scripts/better-auth-migrate.mjs`, `backend/alembic/env.py` `EXCLUDED_TABLES` |
| Admin JWKS | web-admin `/api/auth/jwks` | API `ADMIN_JWKS_URL` |
| Origins | web hosts | API `ALLOWED_ORIGINS` |
| Admin site URL | web `NEXT_PUBLIC_ADMIN_URL` | API `ADMIN_URL` |
| Main site URL | web `NEXT_PUBLIC_APP_URL` | web-help `NEXT_PUBLIC_MAIN_URL` |

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
3. Copy `backend/.env.example` to `backend/.env`. Keep the `.test` origins and `ADMIN_JWKS_URL=http://localhost:3001/api/auth/jwks`. After the first admin sign-in, run `uv run python scripts/admin_jwk_thumbprints.py` and put its output in `ADMIN_JWKS_THUMBPRINTS`, then restart the API.

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
- Subdomain mode is the standard local setup. It is the only mode that tests the host rules, the parent-domain session cookie and the links between hosts.
- In subdomain mode, open `carabao.test:3000`, not `localhost:3000`. The proxy does not redirect `localhost` to `carabao.test`. On `localhost`, some pages open, but sign-in and the links between hosts do not work.
- `dev:admin` uses its own build folder (`.next-admin`) and `tsconfig.admin.json`, so both dev servers can run at the same time.
- While `dev:admin` runs, Next.js changes the import line in `next-env.d.ts` to `.next-admin`. Do not commit that change.
- Without the hosts file, use one-host mode (5.5). The subdomain checks below do not apply in that mode.
- If a page gives `Cannot find module '...css'` but the file is in `node_modules`, the Turbopack cache is old (for example, after the CSS toolchain changed). Stop the dev server, delete `.next` (or `.next-admin`), and start it again.
- The Expo app on a phone cannot resolve `carabao.test`, because the hosts file is only on the PC. The mobile app uses `EXPO_PUBLIC_WEB_URL=http://<PC-LAN-IP>:3000`.

### 5.4 OAuth sign-in (Google, Facebook) on local

Better Auth makes the callback URL from `BETTER_AUTH_URL`: `<BETTER_AUTH_URL>/api/auth/callback/google` and `.../facebook` ([lib/auth.ts](../../frontend/carabao-app/lib/auth.ts), `socialProviders`, no custom `redirectURI`).

In subdomain mode, the callback is `http://carabao.test:3000/api/auth/callback/...`. The providers do not accept it:
- Google: a redirect URI must use HTTPS and a public top-level domain. Only `localhost` can use plain HTTP. `.test` is not public.
- Facebook: strict mode needs HTTPS. Only `localhost` can use HTTP.

Thus Google and Facebook sign-in do not work in subdomain mode. Phone and email sign-in work.

To test OAuth on local:
1. Change to one-host mode (5.5).
2. Use **dev** OAuth clients, not the production clients. Add these redirect URIs to them:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/facebook`
3. Put the dev client IDs and secrets in `.env.local`.
4. When the OAuth work is complete, change back to subdomain mode.

Other options:
- An HTTPS tunnel (for example `cloudflared` or `ngrok`) on a public domain. Register the tunnel callback URL. A tunnel serves one host only, unless you also map a wildcard domain to it.
- Test OAuth only on a hosted deploy (`https://carabao.online/api/auth/callback/...`, see section 7 step 8).

### 5.5 One-host mode (`localhost`)

Use this mode for:
- OAuth work (5.4). Google and Facebook accept `http://localhost` only.
- A PC without the hosts file (5.1).

Subdomain mode (5.2) is the standard mode. Change back to it when the work is complete.

#### How the mode is selected

The site uses subdomain mode only when the host of `NEXT_PUBLIC_APP_URL` is equal to `ROOT_DOMAIN`. When `NEXT_PUBLIC_APP_URL` is `http://localhost:3000`, the site uses one-host mode. You do not change `ROOT_DOMAIN`. It stays `carabao.test`.

#### Where the pages are

In one-host mode, the public dev server (`npm run dev`) serves the merchant and help pages under a path prefix on `localhost:3000`:

| Site | Subdomain mode (standard) | One-host mode |
|---|---|---|
| Buyer | `http://carabao.test:3000/` | `http://localhost:3000/` |
| Merchant dashboard | `http://merchant.carabao.test:3000/` | `http://localhost:3000/merchant` |
| A merchant page (example: routing) | `http://merchant.carabao.test:3000/routing/5` | `http://localhost:3000/merchant/routing/5` |
| Merchant onboarding | `http://merchant.carabao.test:3000/onboarding` | `http://localhost:3000/merchant/onboarding` |
| Help (FAQ) | `http://help.carabao.test:3000/` | `http://localhost:3000/help` |
| Terms, Privacy | `http://help.carabao.test:3000/terms`, `/privacy` | `http://localhost:3000/help/terms`, `/help/privacy` |
| A help page (example: contact) | `http://help.carabao.test:3000/contact` | `http://localhost:3000/help/contact` |
| Admin | `http://admin.carabao.test:3001/` | see "Admin site" below |

The links in the site change to these paths automatically. There are no host redirects in one-host mode.

Note: `/merchant/<digits>` (for example `/merchant/42`) is an old shop link. It redirects to `/farms/42` in both modes.

#### Values to change

Change only the values in this table. Keep all other values.

| File | Name | Subdomain mode (standard) | One-host mode |
|---|---|---|---|
| `frontend/carabao-app/.env.local` | `NEXT_PUBLIC_APP_URL` | `http://carabao.test:3000` | `http://localhost:3000` |
| `frontend/carabao-app/.env.local` | `BETTER_AUTH_URL` | `http://carabao.test:3000` | `http://localhost:3000` |
| `frontend/carabao-app/.env.local` | `NEXT_PUBLIC_MERCHANT_URL`, `NEXT_PUBLIC_HELP_URL` | empty | empty (if they have a value, the links go to that host) |
| `frontend/carabao-app/.env.admin.local` | `AUTH_JWT_ISSUER` | `http://carabao.test:3000` | `http://localhost:3000` |
| `backend/.env` | `BETTER_AUTH_URL` | `http://carabao.test:3000` | `http://localhost:3000` |
| `backend/.env` | `APP_URL` | `http://carabao.test:3000` | `http://localhost:3000` |
| `backend/.env` | `ALLOWED_ORIGINS` | `http://carabao.test:3000,http://merchant.carabao.test:3000,http://admin.carabao.test:3001` | `http://localhost:3000,<admin origin>` |

Why each value changes:
- Web `BETTER_AUTH_URL` gives the OAuth callback URL and the token issuer. It must be on `localhost` for OAuth.
- The token issuer must be the same in three places: web (`BETTER_AUTH_URL`, because `AUTH_JWT_ISSUER` is empty), web-admin (`AUTH_JWT_ISSUER`) and the API (`BETTER_AUTH_URL`). If one of them is different, the API refuses the tokens with 401. If you do not change the admin value, admin sign-in works, but all admin API calls fail.
- `APP_URL` is the return page after a PayMongo payment.
- `ALLOWED_ORIGINS` is the CORS list. The browser calls the API from `localhost:3000`, so that origin must be in the list.

Do not change `ROOT_DOMAIN`, `NEXT_PUBLIC_API_URL`, `PUBLIC_JWKS_URL` (empty) or `ADMIN_JWKS_URL` (`http://localhost:3001/api/auth/jwks`).

#### Admin site

The admin site always runs on its own port (3001), in both modes. Select one of these options:

| | Option A: the hosts file has `admin.carabao.test` | Option B: no hosts file |
|---|---|---|
| Open | `http://admin.carabao.test:3001` | `http://localhost:3001` |
| `.env.admin.local` `BETTER_AUTH_URL` | `http://admin.carabao.test:3001` (no change) | `http://localhost:3001` |
| `.env.admin.local` and `.env.local` `NEXT_PUBLIC_ADMIN_URL` | `http://admin.carabao.test:3001` (no change) | `http://localhost:3001` |
| `backend/.env` `ADMIN_URL` | `http://admin.carabao.test:3001` (no change) | `http://localhost:3001` |
| `<admin origin>` in `ALLOWED_ORIGINS` | `http://admin.carabao.test:3001` | `http://localhost:3001` |

With option B, both sites are on the host `localhost`. This is safe: the cookie names are different (`carabao.*` and `carabao-admin.*`), so each site reads only its own session.

#### Change the mode

1. Stop the three servers (public, admin, API).
2. Change the values in the tables above.
3. Start the three servers again (5.3). The `NEXT_PUBLIC_*` values are read when the dev server starts.
4. Sign in again. The old session cookie is on `carabao.test`, so `localhost` does not have it.

To change back to subdomain mode, set the "Subdomain mode (standard)" values again and do steps 1 to 4.

### 5.6 Help deploy (optional)

```
cd frontend/carabao-app
APP_SURFACE=help ROOT_DOMAIN=carabao.test NEXT_PUBLIC_APP_URL=http://help.carabao.test:3002   NEXT_PUBLIC_MAIN_URL=http://carabao.test:3000 npx next build
APP_SURFACE=help ROOT_DOMAIN=carabao.test NEXT_PUBLIC_APP_URL=http://help.carabao.test:3002   NEXT_PUBLIC_MAIN_URL=http://carabao.test:3000 npx next start -p 3002
```

Next.js also reads `.env.local`, if it exists. To check that the build needs nothing else, build a copy of the folder without `.env*` files (the check on 2026-11-16 did this).

This build uses `.next`, as `npm run build` does. Run `npm run build` again before you start the public site from it.

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
| 8 | Open `carabao.test:3000/help?section=terms`, then `carabao.test:3000/privacy` | redirect to `help.carabao.test:3000/terms`, then `help.carabao.test:3000/privacy` |
| 9 | Open `help.carabao.test:3000/` signed out | FAQ, no sign-in asked |
| 9a | Help deploy (5.6): open `help.carabao.test:3002/`, `/contact`, `/help/contact`, `/order`, `/api/auth/get-session` | 200, 200, redirect to `/contact`, 404, 404 |
| 9b | Help deploy: Terms and Privacy in the nav | open `help.carabao.test:3002/terms` and `/privacy` (same host) |
| 10 | On the admin site, sign in with a non-admin email account | "This account is not an admin account." and no session |
| 11 | On the admin site, call `POST /api/auth/sign-in/social` or `/api/auth/sign-up/email` | 404 |
| 12 | Admin: sign in on the admin site with password, then TOTP | dashboard. API calls work (token from `jwks_admin`). |
| 13 | Merchant: in the sidebar click "View my shop" and "Buyer site", the top-bar profile link, and a "Routing" link on Shipments | apex shop page, apex `/order`, apex profile, `merchant.` routing page |
| 14 | Open a "New paid order" notification (stored link `/merchantDashboard`) | opens `merchant.` `/sales` |
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
3a. Make the web-help service the same way, with only the four vars in 2.4.
4. Custom domains:
   - web: `carabao.online`, `merchant.carabao.online`
   - web-help: `help.carabao.online`
   - web-admin: `admin.carabao.online`
   - API: `api.carabao.online`
5. Put Cloudflare Access in front of `admin.carabao.online` only.
6. API: set `ALLOWED_ORIGINS`, `APP_URL`, `ADMIN_URL`, and `ADMIN_JWKS_URL` (private network URL), then restart.
6a. Sign in once on the admin site (this makes the first admin key). Then run `uv run python scripts/admin_jwk_thumbprints.py` in `backend` against the production database, check that every listed key is one web-admin made, and set `ADMIN_JWKS_THUMBPRINTS` on the API. Restart the API. Until then, the admin site signs in but its API calls get 401.
7. Set web vars (2.1), then rebuild web (the `NEXT_PUBLIC_*` values are fixed at build).
8. OAuth redirect URIs stay on the apex (`https://carabao.online/api/auth/callback/...`).
9. Do the checklist in section 6 on the real hosts.
