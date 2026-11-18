# Carabao System Reference

Working reference for development. Same facts as `Carabao_System_Manual.pdf` (Issue 1, 2026-11-16, branch Security-Checkup), plus code locations and the rules that keep the parts in step.

When you change a fact below in the code, update this file in the same change.

**Hosts and surfaces** (apex, `merchant.`, `help.`, `admin.`; two web deploys; two JWT key sets): see `SUBDOMAINS.md`. Where that file and this one differ, `SUBDOMAINS.md` is newer (2026-11-16, branch `feat/subdomains`).

---

## 1. Components

| Part | Path | Stack | Function |
|---|---|---|---|
| Web app | `frontend/carabao-app` | Next.js 16, React 19, Better Auth 1.6, Node 20+ (24 in use) | Website. Better Auth is the only identity source. Issues 15-min EdDSA JWTs. Sends security headers and the CSP. |
| API | `backend` | FastAPI, Python 3.13, SQLAlchemy, Alembic, uv | Business rules: shops, produce, carts, orders, payments, payouts, chat, admin. Checks JWTs with JWKS. Holds no signing key. |
| Database | (one Postgres DB) | PostgreSQL | Better Auth tables (`user`, `session`, `account`, `verification`, `jwks`) and all API tables. Both apps use the same DB. |
| Mobile app | `mobile/CarabaoMobile` | Expo / React Native | Buyer and merchant app. Signs in through Better Auth on the web app. Calls the API. |

External services:

| Service | Used by | Function |
|---|---|---|
| PayMongo | API | Checkout sessions, webhooks, outward transfers (payouts) |
| Semaphore | API | SMS: account codes, payout codes, order alerts, admin setup links |
| Resend | API | Email: password reset, email verification, admin setup links, payout change alerts |
| Cloudflare R2 | API | Public bucket (photos, logos, banners). Private bucket (RSBSA and government ID documents) |
| Mapbox | Web app, API | Browser maps. Road data and geocoding in the API (blocked on some dev networks; use OSRM/Nominatim for local benchmarks) |
| Google, Facebook | Web app | OAuth through Better Auth |

### Connections

```
Browser / Mobile
  (1) sign in -> web app (session cookie)
  (2) GET /api/auth/token -> JWT (kept in memory only, never a cookie)
  (3) API call with Authorization: Bearer <JWT>
API -> GET <BETTER_AUTH_URL>/api/auth/jwks   (public keys, cached 1 h, refetch on unknown kid)
Web app -> API  POST /internal/sms/account-otp, /email/send-password-reset, /email/send-verification
                header X-Internal-Auth-Sync-Secret = AUTH_SYNC_SHARED_SECRET
Web app, API -> same Postgres
API -> PayMongo, Semaphore, Resend, R2, Mapbox
```

The web app never sends SMS or email itself. It asks the API.

---

## 2. Key files

| Topic | File |
|---|---|
| Better Auth config, plugins, hooks | `frontend/carabao-app/lib/auth.ts` |
| Better Auth migration (schema plugin list) | `frontend/carabao-app/scripts/better-auth-migrate.mjs` |
| Admin 2FA helpers (pure, tested) | `frontend/carabao-app/lib/admin-two-factor.ts` |
| Blocked Better Auth admin endpoints | `frontend/carabao-app/lib/blocked-auth-paths.ts` |
| Postgres TLS (web) | `frontend/carabao-app/lib/db-ssl.mjs` |
| Security headers, HSTS | `frontend/carabao-app/next.config.ts` |
| CSP with nonce, host routing | `frontend/carabao-app/proxy.ts` |
| Host rules, cross-host links | `frontend/carabao-app/lib/urls.ts` |
| SEO metadata, sitemap data | `frontend/carabao-app/lib/seo.ts` |
| JSON-LD structured data (farm pages: LocalBusiness, Product/Offer, BreadcrumbList) | `frontend/carabao-app/lib/structured-data.ts` |
| Sitemap entries per host (buyer pages + farms with `lastModified`; help pages) | `frontend/carabao-app/lib/sitemap.ts`, used by `app/sitemap.ts` |
| Admin deploy endpoint allow-list | `frontend/carabao-app/lib/blocked-auth-paths.ts` |
| Admin sign-in page | `frontend/carabao-app/app/(admin-auth)/admin/login/` |
| Admin dev server | `frontend/carabao-app/scripts/dev-admin.mjs` |
| Web origins in API links | `backend/app/core/urls.py` |
| CSP report sink | `frontend/carabao-app/app/api/csp-report/route.ts` |
| Admin 2FA enrol page | `frontend/carabao-app/app/(standalone)/two-factor/enrol/` |
| API app, middleware, cleanup loop | `backend/main.py` |
| Postgres TLS (API) | `backend/app/core/database_url.py` |
| JWT verification | `backend/app/core/security.py` |
| Auth dependencies, internal secret | `backend/app/api/dependencies.py` |
| Field encryption (TIN, RSBSA) | `backend/app/core/field_crypto.py` |
| Body size limit | `backend/app/core/body_limit.py` |
| Request ID, error references | `backend/app/core/errors.py` |
| Status enums | `backend/app/models/statuses.py` |
| Money arithmetic | `backend/app/services/money.py` |
| OTP codes (API-owned) | `backend/app/services/otp.py` |
| Rate limits | `backend/app/services/rate_limit.py` |
| Payout destination codes | `backend/app/services/payout_otp.py` |
| Payouts | `backend/app/services/payout_service.py` |
| Admin enrolment links | `backend/app/services/admin_enrolment.py` |
| Better Auth table access from API | `backend/app/services/better_auth_store.py`, `backend/app/models/auth_identity.py` |
| Application review state machine | `backend/app/services/application_review.py` |
| Upload validation | `backend/app/services/upload_validation.py` |
| R2 | `backend/app/services/r2_service.py` |
| Checkout reservations | `backend/app/services/order_reservations.py` |
| PayMongo webhook | `backend/app/api/webhooks/paymongo.py` |
| First admin / recovery script | `backend/scripts/make_admin.py` |
| Mobile config | `mobile/CarabaoMobile/src/lib/config.ts` |

---

## 3. Values that must stay in step

| Value | Place A | Place B |
|---|---|---|
| `BETTER_AUTH_URL` / `AUTH_JWT_ISSUER` (token issuer) | web app env (web-admin: `AUTH_JWT_ISSUER`) | API env (exact same origin, no path) |
| Admin JWT key table `jwks_admin` | `lib/auth.ts` | `scripts/better-auth-migrate.mjs`, `alembic/env.py` |
| `AUTH_SYNC_SHARED_SECRET` | web app env | API env |
| JWT audience `carabao-api` | `lib/auth.ts` `JWT_AUDIENCE` | API `BETTER_AUTH_JWT_AUDIENCE` (default) |
| Schema-bearing Better Auth plugins and custom fields | `lib/auth.ts` | `scripts/better-auth-migrate.mjs` |
| Enrolment identifier prefix `admin-2fa-enrol-` | `lib/admin-two-factor.ts` | `better_auth_store.enrolment_identifier()` |
| Enrolment token hash (SHA-256 hex) | `hashEnrolmentToken()` | `admin_enrolment.hash_token()` |
| Old-number alert window, 3 days | `OLD_NUMBER_ALERT_WINDOW_MS` in `lib/auth.ts` | `OLD_NUMBER_ALERT_WINDOW` in `phone_verification.py` |
| Phone code length 6, TTL 600 s, 5 attempts | `lib/auth.ts` phoneNumber() | `backend/app/services/otp.py` |
| Phone format `+639XXXXXXXXX` | `lib/phone.ts` `normalizePhMobile` | `phone_verification.normalize_ph_mobile` (returns without `+`) |
| Status values | `backend/app/models/statuses.py` | `frontend/.../util/api/statuses.ts` |
| Review reply max length 1000 (CF-0043) | `REPLY_MAX_LENGTH` in `backend/app/schemas/review.py` | `REPLY_MAX_LENGTH` in `frontend/.../lib/review-reply.ts` |
| Cart line `issue` values (CF-0042) | `CartIssue` in `backend/app/api/routes/_order_helpers.py` and `schemas/cart.py` | `frontend/.../lib/cart-issues.ts` (unknown values show no message but still block checkout) |
| Public farm fields (CF-0048): no `address`, `barangay`, `lat`/`lng`, `legal_business_name`, `user_id` on `GET /merchants` and `/merchants/{id}`; the owner reads them from `GET /merchants/me` | `PublicMerchantResponse` in `backend/app/schemas/merchant.py` | owner-only fields in `Merchant` (`frontend/.../util/api/merchants.ts`), merchant site `MerchantContext` (`fetchMyMerchant`), `lib/structured-data.ts` (also leaves them out) |
| Payment states with a receipt (CF-0049): `paid`, `refund_pending`, `refunded` | `MONEY_RECEIVED_STATUSES` in `backend/app/services/order_status.py` (used by `GET /orders/me/{id}/receipt`) | `hasReceipt()` in `frontend/.../lib/receipt.ts` (shows "View receipt") |
| Input text limits (CF-0051): produce name 100, description 2000; shop title 100, description 2000; `unit_quantity` > 0 and ≤ 1000 | `backend/app/schemas/produce.py`, `shopPage.py` (input schemas only, `extra="forbid"`) | `frontend/.../lib/input-limits.ts` (form `maxLength`) |
| Postgres TLS rules | `lib/db-ssl.mjs` | `app/core/database_url.py` |
| Mobile app scheme `carabaomobile://` | `lib/auth.ts`, `lib/admin-two-factor.ts` | mobile `app.json` |

---

## 4. Environment variables

Files: API `backend/.env` (start from `backend/.env.example`). Web `frontend/carabao-app/.env.local`. Mobile `mobile/CarabaoMobile/.env`. On a host, the same names go in the service settings.

Hard start-up failures:
- API: `DATABASE_URL` missing, or `FIELD_ENCRYPTION_KEY` / `FIELD_HMAC_KEY` missing, malformed, equal, or unable to decrypt a stored TIN.
- Web: no Postgres URL.

### 4.1 API

| Name | Need | Local | Production / notes |
|---|---|---|---|
| `APP_ENV` | Yes | `development` | `production`. Only `development` or `local` enables `/docs`, `/redoc`, `/openapi.json` and Expo CORS origins (`localhost:8081`, `localhost:19006`, `exp://...`). Unset = production behavior (fail closed). |
| `DATABASE_URL` | Yes | `postgresql://user:pass@localhost:5432/carabao` | Hosted URL; same DB as web. `postgres://` and `postgresql+psycopg2://` are normalized to psycopg 3. |
| `PGSSL_CA` | Hosted DB | empty | PEM of DB CA. Literal `\n` accepted (one line on hosts). Written to a temp file for libpq. Empty = system trust store. |
| `PGSSL_SERVERNAME` | Hosted DB | empty | Name on server cert. Railway proxy: `localhost` (sets `host`=name, `hostaddr`=resolved proxy IP). |
| `FIELD_ENCRYPTION_KEY` | Yes | local key | base64 of 32 bytes, AES-256-GCM |
| `FIELD_HMAC_KEY` | Yes | local key | base64 of 32 bytes; must differ from encryption key; never change after data exists (blind indexes) |
| `FIELD_ENCRYPTION_KEY_PREVIOUS` | No | empty | Only during rotation (read-only key) |
| `BETTER_AUTH_URL` | Yes | `http://localhost:3000` | Web origin; must equal web app's `BETTER_AUTH_URL`. Also the token issuer when `AUTH_JWT_ISSUER` is empty. |
| `AUTH_SYNC_SHARED_SECRET` | Yes | same as web | Same as web. Also the HMAC key for stored OTP hashes. |
| `ALLOWED_ORIGINS` | Yes | `http://localhost:3000` | CORS comma list: apex, `merchant.`, `admin.`. Wildcards are dropped. |
| `APP_URL` | Yes | `http://localhost:3000` | Payment return pages (fallback `http://localhost:3000`) |
| `ADMIN_URL` | Yes | `http://localhost:3001` | 2FA setup links (fallback `APP_URL`) |
| `PUBLIC_JWKS_URL` | No | empty | public key set (old name `BETTER_AUTH_JWKS_URL`) |
| `ADMIN_JWKS_URL` | Yes | `http://localhost:3001/api/auth/jwks` | admin key set; prod: Railway private URL |
| `AUTH_JWT_ISSUER` | No | empty | issuer override (else `BETTER_AUTH_URL`) |
| `FRONTEND_URL` | No | | no longer read; use `APP_URL` |
| `RATE_LIMIT_TRUST_PROXY` | Prod | empty | `true` behind Railway/Vercel, else all clients share the proxy IP |
| `PAYMONGO_USE_TEST` | Yes | `true` | `false` for live |
| `PAYMONGO_SECRET_TEST_KEY` | Test | sk_test | used only in test mode |
| `PAYMONGO_SECRET_KEY` | Live | empty | sk_live. The API reads no PayMongo public key. |
| `PAYMONGO_WEBHOOK_SECRET` | Yes | test webhook secret | live webhook secret; one webhook + secret per mode |
| `CLOUDFLARE_ACCOUNT_ID` | Uploads | | |
| `CLOUDFLARE_R2_BUCKET_NAME` | Uploads | | public bucket |
| `CLOUDFLARE_R2_PRIVATE_BUCKET_NAME` | Uploads | | private bucket (RSBSA, government IDs); must not be public |
| `CLOUDFLARE_R2_PUBLIC_URL` | Uploads | | |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Uploads | | access to both buckets |
| `RESEND_KEY`, `RESEND_FROM` | Email | | From on a verified domain (default `Carabao <onboarding@resend.dev>`) |
| `SEMAPHORE_KEY` (or `SEMAPHORE_API_KEY`), `SEMAPHORE_SENDER_NAME` (or `SEMAPHORE_SENDERNAME`) | SMS | | approved sender |
| `MAPBOX_ACCESS_TOKEN` | Maps | | |

Optional tuning (defaults):

| Name | Default | Function |
|---|---|---|
| `ORDER_RESERVATION_TTL_MINUTES` | 30 | stock hold and PayMongo session life |
| `ORDER_AUTO_CONFIRM_DAYS` | 7 | auto-confirm delivered orders |
| `REVIEW_WINDOW_DAYS` | 30 | review window after delivery |
| `PAYOUT_TRANSFER_FEE` | 10 | pesos taken per payout |
| `ACCOUNT_OTP_PER_HOUR` | 5 | account SMS codes per number per hour |
| `BETTER_AUTH_JWT_AUDIENCE` | `carabao-api` | must match `lib/auth.ts` |
| `BETTER_AUTH_JWKS_URL` | `<BETTER_AUTH_URL>/api/auth/jwks` | old name of `PUBLIC_JWKS_URL` |
| `SEMAPHORE_BASE_URL` | Semaphore API | override |

Perf-only (`backend/scripts/perf`): `PERF_DATABASE_URL`, `PERF_CLIENT_CSV`, `PERF_RUN_DIR`, `PERF_BUYERS`, `PERF_MERCHANTS`, `PERF_MAPBOX`, `PERF_PAYMONGO`, `FASTAPI_JWT_SECRET`.

### 4.2 Web app

| Name | Need | Local | Production / notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | same DB as API | Also read: `POSTGRES_URL` (first), `POSTGRESQL_URL`, `PGDATABASE_URL` |
| `PGSSL_CA`, `PGSSL_SERVERNAME` | Hosted DB | empty | same as API |
| `BETTER_AUTH_SECRET` | Yes | local secret | changing it signs everyone out |
| `BETTER_AUTH_URL` | Yes | `http://localhost:3000` | public https web origin; token issuer; Better Auth `baseURL` (fallback `NEXT_PUBLIC_APP_URL`) |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` | on `ROOT_DOMAIN` = subdomain mode |
| `ROOT_DOMAIN` | No | `carabao.test` | default `carabao.online` |
| `APP_SURFACE` | No | `public` | `admin` on web-admin |
| `NEXT_PUBLIC_MERCHANT_URL`, `NEXT_PUBLIC_HELP_URL`, `NEXT_PUBLIC_ADMIN_URL` | No | | default derived from the app URL |
| `AUTH_JWT_ISSUER` | web-admin | | public origin; required on web-admin |
| `NEXT_PUBLIC_API_URL` (or `NEXT_PUBLIC_FASTAPI_URL`) | Yes | `http://localhost:8000` | API origin; also put in CSP `connect-src` |
| `AUTH_SYNC_SHARED_SECRET` | Yes | same as API | |
| `NEXT_PUBLIC_MAPBOX_API_KEY` | Maps | | limit to domain |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opt | dev client; works only in one-host mode (`SUBDOMAINS.md` 5.4) | redirect `<web>/api/auth/callback/google` |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | Opt | dev client; works only in one-host mode (`SUBDOMAINS.md` 5.4) | redirect `<web>/api/auth/callback/facebook` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | No | | extra trusted origins (comma list). Trusted list also includes `NEXT_PUBLIC_APP_URL`, `RAILWAY_PUBLIC_DOMAIN`, `carabaomobile://`, and `exp://` in dev |
| `CSP_ENFORCE` | No | empty | empty = Report-Only; `true` = enforced + `upgrade-insecure-requests` |
| `BETTER_AUTH_RATE_LIMIT` | No | empty | on in production; `true` enables locally |
| `MOCK_AUTH_SESSION` | No | `false` | never `true` on a host (fixed session without sign-in) |
| `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` | No | | idle sign-out |
| `NEXT_PUBLIC_FEATURE_LANGUAGE_TOGGLE` | No | | language switch |

`NEXT_PUBLIC_*` values are baked in at build. Set before build; rebuild after a change.

### 4.3 Mobile

| Name | Local | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://<PC-LAN-IP>:8000` | on a device, localhost is the phone (default `http://localhost:8000`) |
| `EXPO_PUBLIC_WEB_URL` | `http://<PC-LAN-IP>:3000` | Better Auth host |
| `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` | empty | optional |

### 4.4 Postgres TLS

- Always `verify-full` / `rejectUnauthorized: true`. No switch to turn it off.
- Host `localhost`, `127.0.0.1`, `::1` = no TLS.
- Railway TCP proxy: cert is for `localhost`, signed by a per-DB `root-ca`. Set `PGSSL_CA` = that root-ca PEM and `PGSSL_SERVERNAME=localhost` in both apps.
- `PGSSL_REJECT_UNAUTHORIZED` is no longer read.

### 4.5 Stale values in the current env files (as of 2026-11-16)

| File | Name | Action |
|---|---|---|
| backend/.env | `FASTAPI_JWT_SECRET` | remove (perf script only) |
| backend/.env | `UNISMS_API_SECRET_KEY` | remove |
| backend/.env | `R2-TOKEN_ID` | remove (invalid name) |
| .env.local | `PGSSL_REJECT_UNAUTHORIZED` | remove |
| .env.local | `NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY` | remove |
| .env.local | `RESEND_KEY` | remove (only the API sends email) |
| .env.local | `NEXT_PUBLIC_FEATURE_LANGUAGE_TOGGL` | rename to `..._TOGGLE` |

### 4.6 Making secrets

```
# FIELD_ENCRYPTION_KEY and FIELD_HMAC_KEY (run twice, use different results)
python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"

# BETTER_AUTH_SECRET and AUTH_SYNC_SHARED_SECRET (run twice)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never reuse production keys locally. Losing `FIELD_ENCRYPTION_KEY` makes stored TIN/RSBSA unreadable.

---

## 5. Local development

Prereqs: Python 3.13+, uv 0.10+, Node 20+, Postgres (local or hosted), Git. Optional: cloudflared/ngrok (webhooks), an authenticator app (admin).

Local Postgres in Docker, step by step, with the known setup problems: [LOCAL_DATABASE.md](LOCAL_DATABASE.md).

```
# dependencies
cd backend && uv sync
cd frontend/carabao-app && npm install
cd mobile/CarabaoMobile && npm install        # optional

# database: Better Auth tables FIRST (API migration d3f7b1e9a5c2 adds FKs to "user")
cd frontend/carabao-app
npm run auth:migrate            # prints SQL only; must include "jwks"
npm run auth:migrate:apply
cd backend
# EMPTY database: the Alembic history starts from existing tables, so
# "alembic upgrade head" fails (relation "backend_users" does not exist).
uv run python scripts/create_tables.py
uv run alembic stamp head
# Database that already has the tables:
uv run alembic upgrade head

# run
cd backend && uv run uvicorn main:app --reload --port 8000   # log: "Field encryption keys OK"
cd frontend/carabao-app && npm run dev                       # http://localhost:3000
cd mobile/CarabaoMobile && npx expo start                    # optional
```

`/docs` at `http://localhost:8000/docs` only with `APP_ENV=development`.

Tested on an empty DB on 2026-11-17 (Docker `postgres:17`), with `create_tables.py` + `alembic stamp head`. `create_all` makes the schema from the models, so constraints or indexes that only a revision adds are not present (LOCAL_DATABASE.md 6.2).

The DB was wiped before this branch; migrations carry no legacy data.

### First user and admin

1. Sign up on the website with a mobile number. Enter the 6-digit code. Set a password.
2. `cd backend && uv run python scripts/make_admin.py admin@example.com` (verified email), or `--create --email admin@example.com` (asks for a password). It sets the role, clears old 2FA, ends sessions, writes an audit row (actor `system`) and prints a one-time link on `ADMIN_URL` (24 h). It does not send the link.
3. Sign in on the admin site (`/admin/login`, email + password), open the link (`/two-factor/enrol?token=...`), scan the QR code, enter the code, keep the backup codes.
4. Sign out, then sign in with password + TOTP. The admin area needs a session with `mfa=true`.

If `NEXT_PUBLIC_API_URL` or `AUTH_SYNC_SHARED_SECRET` is unset in dev, the web terminal logs the code: `[sms] SMS not configured. verify code for ...`.

Admins cannot sign in on mobile (`ADMIN_WEB_ONLY`).

### Payments locally

1. `PAYMONGO_USE_TEST=true` with test keys.
2. `cloudflared tunnel --url http://localhost:8000`.
3. Add a PayMongo test webhook to `https://<tunnel>/webhooks/paymongo` with events `checkout_session.payment.paid`, `transfer.outward.successful`, `transfer.outward.failed`.
4. Put its secret in `PAYMONGO_WEBHOOK_SECRET` and restart the API.

Without a webhook, `GET /transactions/order/{id}` reconciles from PayMongo, and the reservation sweep settles late payments. The merchant SMS can be late.

### Checks before push

```
cd backend && uv run pytest && uv run ruff check . && uv run mypy .
cd frontend/carabao-app && npm test && npm run lint && npm run build
```

`npm test` runs node --test on `util/navigation`, `lib/blocked-auth-paths`, `lib/phone`, `lib/admin-two-factor`, `lib/next-path`. Add new pure-logic test files to the `test` script.

---

## 6. Hosting

The current host is Railway: web app, API and Postgres as separate services.

| Service | Build / start |
|---|---|
| Web | root `frontend/carabao-app`; `npm ci && npm run build`; `npm run start` |
| API | root `backend`; `uv sync --frozen`; `uv run uvicorn main:app --host 0.0.0.0 --port $PORT` |
| DB | hosted Postgres, private |

Multiple API workers or instances are safe. Codes, attempts and rate limits are in the DB, and every worker runs the cleanup loop with row locks.

### First deploy

1. Back up the DB if it has data.
2. Make new production secrets.
3. Set all env vars (4.1, 4.2).
4. On the API, set `APP_ENV=production` and `RATE_LIMIT_TRUST_PROXY=true`.
5. Use the same https `BETTER_AUTH_URL` on both services.
6. Set `ALLOWED_ORIGINS` and `APP_URL` on the API to the web origin.
7. Set `NEXT_PUBLIC_API_URL` on the web app, then build.
8. Run `npm run auth:migrate:apply`, then `uv run alembic upgrade head`, against the production DB. On an EMPTY DB, run `uv run python scripts/create_tables.py` and `uv run alembic stamp head` in place of `alembic upgrade head` (section 5).
9. Start the API and confirm the log shows "Field encryption keys OK". Then start the web app.
10. Run `make_admin.py` in the API service shell.

### External settings

- **PayMongo:** register a live webhook at `https://<api>/webhooks/paymongo` with the 3 events and its secret. Set `PAYMONGO_USE_TEST=false`. The platform wallet must be funded for payouts.
- **OAuth:** redirect URIs `<web>/api/auth/callback/google` and `/facebook`. Google and Facebook do not accept `http://carabao.test`, so local OAuth needs one-host mode on `localhost` (`SUBDOMAINS.md` 5.4).
- **Resend:** verify the domain.
- **Semaphore:** get the sender name approved and keep credit on the account.
- **R2:** the photo bucket is public and the document bucket is private. Documents are served through short-lived links.
- **Mapbox:** limit the public token to the domain.

### CSP rollout

1. Deploy with `CSP_ENFORCE` empty (Report-Only).
2. Read `[csp-report]` lines in the web logs.
3. Fix real violations and ignore browser extensions.
4. After some days with no real reports, set `CSP_ENFORCE=true` and redeploy.

`frame-ancestors 'none'` and `X-Frame-Options: DENY` are always enforced from `next.config.ts`. HSTS (2 years, includeSubDomains) is sent only in production, so HTTPS must work on the domain first.

### Post-deploy checks

| Check | Expected |
|---|---|
| `<api>/docs` | 404 |
| Phone signup | SMS arrives, account created |
| Admin sign-in | TOTP asked |
| Admin on mobile | refused |
| Small test checkout | order `processing`, merchant SMS |
| Web headers | X-Frame-Options DENY, nosniff, HSTS, CSP |
| API responses | `X-Request-ID` header |

---

## 7. Processes

### 7.1 Sign-up and sign-in

- **Signup is by phone code only.** Better Auth phoneNumber plugin with `signUpOnVerification`. Better Auth makes and stores the code; the API delivers it (`POST /internal/sms/account-otp`, per-number limit). Code is 6 digits, 600 s, 5 attempts. The temp email is `<digits>@<PHONE_PLACEHOLDER_EMAIL_DOMAIN>`.
- **Password after signup:** the user sets it with `POST /phone-number/set-password`. This works only for an account with no `account` rows.
- **`/phone-number/verify` guard** allows only three cases:
  - signup for a new number;
  - `disableSession` for your own number while signed in;
  - `updatePhoneNumber` while signed in.
- **Google and Facebook** can create accounts without a phone. Checkout, merchant applications and buyer chat then need a verified phone (`require_verified_phone` returns 403 `PHONE_VERIFICATION_REQUIRED`). Facebook accounts without an email get the placeholder `facebook-<id>@...`.
- **Email + password** is sign-in only (`disableSignUp`). It works for accounts with a verified email. `changeEmail` takes effect after the link is opened.
- **Password reset:** by SMS for all accounts; by email if the email is verified. Reset revokes sessions.
- **Better Auth rate limits (per IP)** are on in production: 100/60 s default.

  | Endpoint | Limit |
  |---|---|
  | `/sign-in/email`, `/sign-in/phone-number` | 10 / 15 min |
  | `/phone-number/send-otp`, `/phone-number/request-password-reset` | 20 / h |
  | `/phone-number/verify` | 30 / 15 min |
  | `/phone-number/reset-password`, `/reset-password` | 10 / 15 min |
  | `/request-password-reset` | 5 / 15 min |
  | `/change-email` | 5 / h |

- **API limits (`rate_limit.py`, sliding window in the `rate_limit_hits` table):**
  - `otp_send`: 20 per IP and 5 per identifier, per 15 min
  - `otp_verify`: 30 per IP and 10 per identifier, per 15 min
  - `account_otp`: 5 per number per hour
  - `otp_send_user`: 5 per user per hour
  - `email_otp_send`: 20 per IP and 5 per email, per 15 min
  - `email_otp_verify`: 30 per IP and 10 per email, per 15 min
  - `email_otp_send_user`: 5 per user per hour
  - Action limits (`ACTION_LIMITS`, 429 "Too many requests", CF-0037):
    - `review_write`: 10 review creates + edits per user per hour
    - `review_reply`: 30 merchant reply writes + deletes per user per hour (CF-0043)
    - `order_chat_send`: 30 order chat messages per user per minute
    - `support_chat_send`: 20 support messages per user per minute
    - `produce_search`: 120 `/produce/search` calls per IP per minute (needs `RATE_LIMIT_TRUST_PROXY=true` behind a proxy)
    - `order_place`: 20 `POST /orders/me/place` calls per user per hour, refused ones included (CF-0045)
    - `payment_checkout`: 30 `POST /payments/checkout/{order_id}` calls per user per hour (CF-0045)
    - `farm_follow`: 60 follow + unfollow calls per user per hour (CF-0054); a buyer follows at most 500 farms (`MAX_FOLLOWS`, 409 above)
  - Open unpaid orders: a buyer with `MAX_OPEN_PENDING_ORDERS` (10, `services/order_reservations.py`) PENDING orders gets 409 from place-order until they pay, cancel, or the reservation TTL releases them (CF-0045)
- Better Auth admin plugin HTTP endpoints are blocked (404). Server-side `auth.api.*` calls still work.

### 7.2 Tokens

- **Issuing:** the client gets a JWT from `GET /api/auth/token`. The JWT plugin signs it with EdDSA. It lasts 15 min. Issuer = `AUTH_JWT_ISSUER` or `BETTER_AUTH_URL` origin, audience `carabao-api`. The payload adds `mfa` (whether the session passed TOTP) and `surface`. The public deploy signs with keys in `jwks`, the admin deploy with keys in `jwks_admin`.
- **Surface:** the API takes it only from the key set that verified the token. A disagreeing `surface` claim is 401. `/admin/*` needs surface `admin` (see `SUBDOMAINS.md` 1.4).
- **Checking:** the API checks `exp`, `iat`, `sub`, `iss` and `aud`, with 30 s leeway.
  - JWKS unreachable → 503.
  - Invalid token → 401.
- **Live user data:** the API reads name, email, phone, role, ban and 2FA from the `user` table on each request, so a ban works before the token expires. The backend user row is created on first use (`resolve_user`).

### 7.3 Admin 2FA

- Only admins use 2FA, and the admin area and API require it (`mfa_session`; else 403 `ADMIN_MFA_SESSION_DETAIL`).
- **Enrolling** needs a one-time token. Only an admin action creates one:
  - promote with `PATCH /admin/users/{id}/role`;
  - 2FA reset or resend;
  - `make_admin.py`.

  The token's SHA-256 is stored in `verification` as `admin-2fa-enrol-<userId>`, lasts 24 h, and is sent by SMS and email to verified contacts (502 if both fail). It goes in header `x-admin-enrol-token` on `/two-factor/enable` and is deleted after `/two-factor/verify-totp`. Setup is passwordless (`allowPasswordless`).
- **Disabling:** admins cannot disable 2FA. Another admin resets it.
- **Every sign-in method asks for TOTP.** For social or email-link sign-ins, the after-hook drops the session, sets the `two_factor` cookie (10 min) and redirects to `/two-factor`.
- **`session.mfaVerified`** is set at session creation:
  - true via `/two-factor/verify-totp` or `/two-factor/verify-backup-code`;
  - true via a password sign-in that survives because of a trusted device;
  - copied when a session is replaced.
- **Secret endpoints:** `/two-factor/get-totp-uri` and `generate-backup-codes` need `mfaVerified`.
- **Mobile:** admin sign-in from mobile (`expo-origin` header, or `carabaomobile://` / `exp://` origin) is refused with `ADMIN_WEB_ONLY`.

### 7.4 Merchant applications

```
applicant: (none) | rejected | clarification --submit--> submitted
           approved --> submitted only after the merchant closed the account
admin:     submitted --> approved | rejected | clarification
           approved  --> suspended (also suspends the merchant)
other moves: 409
```

- **Form:** 2 sections.
  1. Operations and contact: location, map pin, available days, contact email, contact number. The email and the number each need a 6-digit code, unless the value is the account's own verified email or number. The applicant cannot continue until both are verified.
  2. Legal and documents: business details, TIN, registration, RSBSA number, RSBSA document, government ID type and government ID document.
- **Contact proofs:** `POST /sms/otp/verify` returns a token with purpose `merchant_phone`. `POST /email/otp/verify` returns a token with purpose `merchant_email`. Each token is for one user and one value and lasts 60 min (`CONTACT_VERIFICATION_TTL`). The submit refuses a contact value that has no proof (400).
- Endpoints:
  - `POST /email/otp/send`, `POST /email/otp/verify` (contact email codes, signed-in user)
  - `POST /merchant-onboarding/me` (multipart: `payload`, `rsbsa_file`, `gov_id_file`)
  - `PATCH /admin/merchant-applications/{id}` (records `reviewed_by_user_id` and `reviewed_at`; approval also sets `merchants.verified_by_user_id` and `verified_at`)
  - `GET /admin/merchant-applications/{id}/rsbsa-document`, `GET /admin/merchant-applications/{id}/gov-id-document` (short-lived links to the private bucket)
- **Documents:** R2 keys `rsbsa/{user_id}/...` and `gov-id/{user_id}/...` in the private bucket. Both files are checked before either is uploaded. If the submit fails after an upload, the API deletes the uploaded objects. Approval copies the keys and metadata to `merchants`, not the files.
- **Government ID types:** PhilSys National ID, Passport, Driver's License, UMID, SSS, PRC, Postal ID, Voter's ID, PhilHealth, Senior Citizen ID, PWD ID (`GovIdType`). RSBSA is a separate upload.
- **Document check columns** (`check_status`, `check_flags`, `gov_id_number_hmac`, `ocr_rsbsa_number_hmac`, file SHA-256s, OCR name and score) exist on `merchant_applications` but nothing fills them yet.
- **Identifier storage:** TIN and RSBSA are encrypted (`EncryptedString`, `v1:` prefix, purpose as AAD). Lookups and uniqueness use the `*_hmac` blind-index columns (normalized alphanumeric, uppercase). Non-admins see masked values (`***-***-***-000`).
- **Uploads:**
  - Images are 5 MB max, re-encoded with Pillow (strips EXIF/GPS), JPEG/PNG/WEBP only, and limited to 40 MP and 4096 px per side.
  - PDFs are 20 MB max. They need the magic bytes, must parse, and must not be encrypted or contain JS, launch actions or embedded files.
- **Body limits:** 12 MB by default; 42 MB for `/merchant-onboarding/me` (2 documents). Oversize → 413, with CORS headers.

### 7.5 Checkout and payment

1. Checkout creates one order per merchant (`pending`) and holds the stock.
2. The API creates a PayMongo checkout session (`POST /checkout/{order_id}`). The hold and the session last `ORDER_RESERVATION_TTL_MINUTES` (30).
3. PayMongo sends the `checkout_session.payment.paid` webhook. The signature is checked against the secret for the current mode (`te` or `li`).
4. The API compares the amount and currency with the order.
   - **Match:** the order goes to `processing` and the merchant gets an SMS.
   - **Mismatch:** the order goes to `payment_mismatch`, the transaction to `refund_pending`, and an admin is alerted.
5. If nothing is paid within the TTL, the sweep releases the stock and expires the session. If PayMongo shows the session as paid, the sweep settles it instead.

Money is stored in whole pesos. Calculations use `Decimal` with ROUND_HALF_UP. The platform fee is 2%. PayMongo gets centavos, converted only at that boundary. An invalid amount raises `InvalidAmount` and never becomes 0. The cap is 10^15.

### 7.6 Status values

- **Order:** `pending` → `processing` → `shipped` → `out_for_delivery` → `delivered`. Also `cancelled` and `payment_mismatch`.
- **Transaction:** `pending`, `paid`, `failed`, `expired`, `refund_pending`, `refunded`.
- **PaymentStatus** is derived and never stored: `awaiting_payment`, `paid`, `refund_pending`, `refunded`, `unpaid`.
- **Payout batch:** `pending` → `approved` → `processing` → `released` or `failed`. A merchant can have only one open batch (pending, approved or processing) at a time.
- Status columns are VARCHAR with named CHECK constraints (`status_type`).

Order timing:
- Delivered orders are auto-confirmed after 7 days.
- Buyers can review for 30 days after delivery.
- Order chat: a buyer message unread for 15 min sends one SMS to the merchant.

### 7.7 Payouts

1. **Set the destination** (bank, GCash or Maya).
   - `POST /merchants/me/payout-info/code` sends a code for that exact destination (SHA-256 fingerprint of the fields) to the verified phone.
   - `PUT /merchants/me/payout-info` saves it with the code.
   - Each change writes a `payout_destination_changes` row and sends email and SMS alerts.
   - For 3 days after a phone change, alerts also go to the previous number. A second change inside the window keeps the original old number.
2. **Cash out:** `POST /merchants/me/payouts/request` creates a `pending` batch and saves the destination and institution name.
3. **Release:** an admin releases the batch with `PATCH /admin/batches/...`. It is locked and committed as `processing` before PayMongo is called, so it can never be sent twice.
4. **Settle:** the webhook `transfer.outward.successful` / `failed` moves the batch to `released` / `failed`. Admins can refresh the status or resend a failed batch.

Routing and fees:
- InstaPay is used up to ₱50,000; PESONet up to ₱10M.
- GCash (`GXCHPHM2XXX`) always goes by PESONet.
- Each payout pays a transfer fee (`PAYOUT_TRANSFER_FEE`, default 10).

**Known issue, unresolved:** PayMongo refuses GCash payouts (AC06 on InstaPay, RR04 on PESONet). Maya works.

### 7.8 Background loop (`main.py` lifespan, every 60 s, every worker)

1. `expire_stale_reservations` releases stock, settles late payments, and sends merchant SMS for orders that turn out paid.
2. `auto_confirm_delivered_orders`
3. `send_unread_merchant_sms`
4. `otp.purge_expired` + `rate_limit.purge_expired` + `retention.purge_old_rows` (CF-0056: `search_log` rows older than 90 days, read notifications read more than 180 days ago; unread ones are kept)

Startup runs `_check_field_encryption_keys`:
- It loads the keys and does a round trip.
- It decrypts one stored TIN if one exists.
- On failure it raises `FieldCryptoError`, and uvicorn does not start.

### 7.9 Errors and logging

- Every response has `X-Request-ID`. The incoming header is accepted when it is valid.
- On an unhandled exception, the server logs `[request_id=...]` with the traceback. The client gets 500 `"Internal server error (ref ...)"` plus `request_id`.
- The request-ID middleware sits inside CORS, so 500 and 413 responses keep their CORS headers.
- Admin actions go to the audit log (`services/audit_log.py`).

### 7.10 OTP storage (API-owned codes)

- `otp_codes` stores only `HMAC-SHA256(AUTH_SYNC_SHARED_SECRET, key + code)`.
- TTL 600 s, resend cooldown 60 s, max 5 attempts.
- Used for merchant contact-number codes and payout destination codes.
- Better Auth stores its own account phone codes.

---

## 8. Maintenance

### Admin recovery

Run `uv run python scripts/make_admin.py <verified number or email>` in the API shell. Then do the first-admin steps 3–4.

### Encryption key rotation

1. Back up the DB.
2. Make a new key.
3. Set `FIELD_ENCRYPTION_KEY_PREVIOUS` to the old key.
4. Set `FIELD_ENCRYPTION_KEY` to the new key. Never change `FIELD_HMAC_KEY`.
5. Restart.

There is no re-encrypt script yet. Keep the previous key until every TIN/RSBSA value has been written again. Removing it early stops the API from starting.

### Database changes

- **API tables:** add an Alembic revision in `backend/alembic/versions`. Alembic excludes `user`, `session`, `account` and `verification` (`alembic/env.py`).
- **Better Auth tables:** change the plugins and fields in `lib/auth.ts` and in `scripts/better-auth-migrate.mjs`, then run `npm run auth:migrate:apply`.
- **Cascades:**
  - Deleting a `user` row cascades to `backend_users`, `carts` and `merchant_applications`.
  - `merchants` and `transactions` block the delete. Use account deletion in the app instead.

### Token settings

If you change the issuer or audience in `lib/auth.ts`, change the API env at the same time. Otherwise every call returns 401.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FieldCryptoError ... is not set` | key missing | set both keys |
| "must decode to 32 bytes" / "not valid base64" | bad key | regenerate (4.6) |
| "stored tin value cannot be decrypted" | wrong key | correct key, or set old one as `_PREVIOUS` |
| "DATABASE_URL is not set" | missing env | set it |
| `password authentication failed` on localhost | a Windows Postgres service also uses port 5432 | stop it, or use another port (LOCAL_DATABASE.md 10.2) |
| `/api/auth/token` 500, then API 401 | no `jwks` table (old migrate script) | `npm run auth:migrate:apply` with the fixed script (LOCAL_DATABASE.md 10.4) |
| `alembic upgrade head`: relation "backend_users" does not exist | empty DB | `create_tables.py` + `alembic stamp head` (section 5) |
| certificate verify failed | CA/servername | `PGSSL_CA` + `PGSSL_SERVERNAME` in both apps |
| every API call 401 | issuer/audience mismatch | same `BETTER_AUTH_URL` both sides, origin only |
| 503 "Could not reach the sign-in service" | JWKS unreachable | API must reach `<BETTER_AUTH_URL>/api/auth/jwks` |
| CORS error in browser | origin not allowed | add to `ALLOWED_ORIGINS` |
| Better Auth "Invalid origin" | untrusted origin | `BETTER_AUTH_URL` or `BETTER_AUTH_TRUSTED_ORIGINS` |
| admin API 403 sign in again | session without TOTP | sign out, sign in with code |
| "setup link is not valid or has expired" | used/replaced/>24 h | new link or `make_admin.py` |
| SMS not arriving | Semaphore key/sender/credit | check settings, API log |
| 429 too many codes | rate limit | wait; `RATE_LIMIT_TRUST_PROXY=true` behind proxy |
| webhook "bad signature" | secret of other webhook/mode | use secret of the webhook matching the key mode |
| order stays pending after paying | webhook not received | check URL/events; open order page to reconcile |
| upload 413 | over limit | see 7.4 |
| map not loading | token or blocked network | check `NEXT_PUBLIC_MAPBOX_API_KEY`, network |
| `NEXT_PUBLIC_` change no effect | baked into build | rebuild |
