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
| Mobile buyer app | `mobile/CarabaoMobile` | Expo SDK 58 / React Native | Carabao. Buyer app. Signs in through Better Auth on the web app. Calls the API. Hands merchant work to the merchant app. |
| Mobile merchant app | `mobile/CarabaoMerchantMobile` | Expo SDK 58 / React Native | Carabao Merchant. Farm app (dashboard, orders, chats, produce, reviews, notifications). Same sign-in and API as the buyer app. |

Mobile apps (split from one app in `MOBILE_MERCHANT_SPLIT_PLAN.md`):

| | Buyer app | Merchant app |
|---|---|---|
| Folder | `mobile/CarabaoMobile` | `mobile/CarabaoMerchantMobile` |
| Name / scheme | Carabao, `carabaomobile://` | Carabao Merchant, `carabaomerchant://` |
| Who may sign in | every account except admins | every account except admins; the root gate (`/users/me` `merchant`) opens the app only for an account with a farm, others see "This app is for farm accounts" |
| Merchant entry points | Profile banner and merchant notifications open the merchant app, else `<web>/merchantDashboard` or `/merchantOnboarding` (`src/lib/openMerchant.ts`) | all merchant screens; "Open buyer app" opens `carabaomobile://`, else the website |
| Shared code | | copies of the buyer files, kept the same by `src/lib/sharedCopies.test.ts` |

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
Web server -> API  GET /produce/{id} (server render of /listings/{id}, lib/seo.ts)
                same header, so it skips the per-IP limit (CF-0084, CF-0088)
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
| Sitemap entries per host (buyer pages + farms with `lastModified` + listings from `GET /produce/sitemap-ids`, at most 5000, CF-0091; help pages) | `frontend/carabao-app/lib/sitemap.ts`, used by `app/sitemap.ts` |
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
| Mobile config | `mobile/CarabaoMobile/src/lib/config.ts`, `mobile/CarabaoMerchantMobile/src/lib/config.ts` (shared copy) |
| Merchant app root gate | `mobile/CarabaoMerchantMobile/app/_layout.tsx`, `src/lib/MerchantContext.tsx` |
| Buyer to merchant hand-off | `mobile/CarabaoMobile/src/lib/merchantHandoff.ts`, `src/lib/openMerchant.ts` |

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
| Review reply max length 1000 (CF-0043) | `REPLY_MAX_LENGTH` in `backend/app/schemas/review.py` | `REPLY_MAX_LENGTH` in `frontend/.../lib/review-reply.ts`; merchant app `mobile/CarabaoMerchantMobile/src/lib/myReviews.ts` (CF-0133, `inStep.test.ts`) |
| Cart line `issue` values (CF-0042) | `CartIssue` in `backend/app/api/routes/_order_helpers.py` and `schemas/cart.py` | `frontend/.../lib/cart-issues.ts`, `mobile/CarabaoMobile/src/lib/cartIssues.ts` (CF-0129; unknown values show no message but still block checkout) |
| Public farm fields (CF-0048): no `address`, `barangay`, `lat`/`lng`, `legal_business_name`, `user_id` on `GET /merchants` and `/merchants/{id}`; the owner reads them from `GET /merchants/me` | `PublicMerchantResponse` in `backend/app/schemas/merchant.py` | owner-only fields in `Merchant` (`frontend/.../util/api/merchants.ts`), merchant site `MerchantContext` (`fetchMyMerchant`), `lib/structured-data.ts` (also leaves them out) |
| Payment states with a receipt (CF-0049): `paid`, `refund_pending`, `refunded` | `MONEY_RECEIVED_STATUSES` in `backend/app/services/order_status.py` (used by `GET /orders/me/{id}/receipt`) | `hasReceipt()` in `frontend/.../lib/receipt.ts` (shows "View receipt"); mobile copy `mobile/CarabaoMobile/src/lib/receipt.ts` (CF-0135, checked by `receipt.test.ts`) |
| Input text limits (CF-0051): produce name 100, description 2000; shop title 100, description 2000; `unit_quantity` > 0 and ≤ 1000 | `backend/app/schemas/produce.py`, `shopPage.py` (input schemas only, `extra="forbid"`) | `frontend/.../lib/input-limits.ts` (form `maxLength`) |
| Search price filter cap (CF-0094): whole pesos, 0 to 1 000 000 (`min_price`/`max_price` above it are a 422) | `backend/app/schemas/produce.py` `MAX_PRICE` (also the listing price cap) | `frontend/.../lib/price-filter.ts` `PRICE_FILTER_MAX` (clamps the typed value) |
| Request bodies refuse unknown fields (CF-0051, CF-0063): every input model has `extra="forbid"`, so a client may send only the fields the API knows. Payout fields: bank code ≤ 20, account number ≤ 40, account name ≤ 100, e-wallet number ≤ 20, codes ≤ 12. Email links from Better Auth must start with `http://` or `https://` (≤ 2000) | `backend/app/schemas/*`, input models in `backend/app/api/routes/*` | Web `util/api/*` and mobile `src/lib/api.ts` bodies; `lib/auth.ts` email hooks |
| Postgres TLS rules | `lib/db-ssl.mjs` | `app/core/database_url.py` |
| Mobile app schemes `carabaomobile://` (buyer), `carabaomerchant://` (merchant) | `lib/auth.ts` `MOBILE_APP_SCHEMES`, `lib/admin-two-factor.ts` `MOBILE_ORIGIN_PREFIXES` | `app.json` `scheme` of each app; each app lists the other in `ios.infoPlist.LSApplicationQueriesSchemes` |

The mobile apps have copies of the status values and labels, the phone pattern, the password policy and the order-history limits (`src/lib/` of each app). `npm test` in each app (`src/lib/inStep.test.ts`) reads the web and backend files above and fails when a copy differs. The merchant copy checks only what the merchant app has (status, password, phone, review reply). The merchant app also copies buyer files (API errors, config, polling, theme, UI, sheets, `dates.ts` ...); `npm test` in `mobile/CarabaoMerchantMobile` (`src/lib/sharedCopies.test.ts`) fails when a copy is not the same as the buyer file.

---

## 4. Environment variables

Files: API `backend/.env` (start from `backend/.env.example`). Web `frontend/carabao-app/.env.local`. Mobile buyer `mobile/CarabaoMobile/.env`, mobile merchant `mobile/CarabaoMerchantMobile/.env.local` (Expo reads `.env` and `.env.local` in each app folder). On a host, the same names go in the service settings.

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
| `RATE_LIMIT_PROXY_HOPS` | No | `1` | How many of our proxies add to `X-Forwarded-For`; the per-IP key is the entry the outermost one added (the right-most with 1), never a client-set left entry (CF-0083). Set `2` only if another proxy (e.g. a CDN) is put in front of Railway |
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
| `ANTHROPIC_API_KEY` | Listing photo vision check (Claude Haiku 5.5) | | Not set: the check does not run. `LISTING_VISION_ENABLED=0` also turns it off |

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
| `ROAD_SNAP_PROVIDER` | `mapbox` with a token, else `off` | map pin road check: `mapbox`, `osrm` or `off` |
| `ROAD_SNAP_MAX_METERS` | 150 | a pin with no drivable road this near is refused |
| `OSRM_URL` | `https://router.project-osrm.org` | OSRM server for `ROAD_SNAP_PROVIDER=osrm` |

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
| `BETTER_AUTH_TRUSTED_ORIGINS` | No | | extra trusted origins (comma list). Trusted list also includes `NEXT_PUBLIC_APP_URL`, `RAILWAY_PUBLIC_DOMAIN`, `carabaomobile://`, `carabaomerchant://`, and `exp://` in dev |
| `CSP_ENFORCE` | No | empty | empty = Report-Only; `true` = enforced + `upgrade-insecure-requests` |
| `BETTER_AUTH_RATE_LIMIT` | No | empty | on in production; `true` enables locally |
| `BETTER_AUTH_RATE_LIMIT_STORAGE` | No | `memory` | `database` keeps Better Auth's per-IP counts in its `rateLimit` table, so they survive deploys and are shared by replicas (CF-0080). Set it only after `npm run auth:migrate:apply` has created that table. Rules: `lib/auth-rate-limit.ts` |
| `MOCK_AUTH_SESSION` | No | `false` | never `true` on a host (fixed session without sign-in) |
| `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` | No | | idle sign-out |

`NEXT_PUBLIC_*` values are baked in at build. Set before build; rebuild after a change.

### 4.3 Mobile

Both mobile apps use the same three names, each in its own folder (see the file names above). Use the same values in both apps.

| Name | Local | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://<PC-LAN-IP>:8000` | on a device, localhost is the phone (default `http://localhost:8000`) |
| `EXPO_PUBLIC_WEB_URL` | `http://<PC-LAN-IP>:3000` | Better Auth host |
| `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` | empty | optional |

Both URLs are checked at app start (`src/lib/baseUrl.ts`, same file in both apps): `scheme://host[:port][/path]` only (no `user@`, query or fragment). A production build (`__DEV__` false) must use `https` for both, or the app stops at launch with an error that names the setting.

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
cd mobile/CarabaoMobile && npm install        # optional, buyer app
cd mobile/CarabaoMerchantMobile && npm install    # optional, merchant app

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
# Both cases: the PSGC address lists (address saves answer 503 until this runs)
uv run python scripts/load_psgc.py
# Both cases: the city/barangay polygons (the pin-area check is off until this runs)
uv run python scripts/load_psgc_boundaries.py
# Both cases: the listing word list (prohibited_terms)
uv run python scripts/load_prohibited_terms.py

# run
cd backend && uv run uvicorn main:app --reload --port 8000   # log: "Field encryption keys OK"
cd frontend/carabao-app && npm run dev                       # http://localhost:3000
cd mobile/CarabaoMobile && npx expo start                    # optional, buyer app
cd mobile/CarabaoMerchantMobile && npx expo start            # optional, merchant app (sign in with a farm account)
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

Admins cannot sign in on mobile (`ADMIN_WEB_ONLY`), in either app.

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
cd mobile/CarabaoMobile && npx tsc --noEmit && npm run lint && npm test
cd mobile/CarabaoMerchantMobile && npx tsc --noEmit && npm run lint && npm test
```

The merchant app's `npm test` reads `../CarabaoMobile` (`sharedCopies.test.ts`) and the web and backend files (`inStep.test.ts`), so run it from a full checkout.

`npm test` runs node --test on the files listed in the `test` script of `package.json`. Add new pure-logic test files there.

`uv run ruff check app` has no findings since CF-0082 (#60): keep it at 0 for new code. The 69 findings left by `ruff check .` are in `tests/` and `scripts/` (B27).

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
8. Run `npm run auth:migrate:apply`, then `uv run alembic upgrade head`, against the production DB. On an EMPTY DB, run `uv run python scripts/create_tables.py` and `uv run alembic stamp head` in place of `alembic upgrade head` (section 5). Then run `uv run python scripts/load_psgc.py`, `uv run python scripts/load_psgc_boundaries.py` and `uv run python scripts/load_prohibited_terms.py`. Then run `backend\db\apply_roles.ps1 -SetPasswords` (SUBDOMAINS.md 3.1).
9. Start the API and confirm the log shows "Field encryption keys OK". Then start the web app.
10. Run `make_admin.py` in the API service shell.

### Updating production (new migrations)

Use this procedure when a deploy adds Alembic revisions or Better Auth schema changes. The API pre-deploy command cannot run them, because it runs as `carabao_api` (SUBDOMAINS.md 3.1). Last done 2026-11-25 (`c3d5e7f9a1b4` → `b3e5f7a9c1d4`, 9 revisions).

You need Docker Desktop running and these values from Railway:

- Postgres service > Variables > `DATABASE_PUBLIC_URL`: the superuser, through the TCP proxy (`*.proxy.rlwy.net`). The private `DATABASE_URL` (`*.railway.internal`) cannot be reached from your PC.
- Backend service > Variables > `PGSSL_CA`. `PGSSL_SERVERNAME` is `localhost`.

**Warning: an empty URL makes every step run on your LOCAL database, and nothing tells you.** `backend/.env` and `frontend/carabao-app/.env*` point to `localhost:5432`, and they are used when the shell has no `DATABASE_URL`. In PowerShell, `$env:DATABASE_URL = ""` deletes the variable. This happens when you press Enter at an empty `Read-Host` prompt. Also, never put the URL in the prompt *text* (`Read-Host "postgresql://..."`): that writes the password to the PSReadLine history file. If that happens, change the `postgres` password.

1. **Back up.** `powershell -ExecutionPolicy Bypass -File backend\db\backup.ps1`. Continue only after `OK: ... every row count matches the restore.`
2. **Set the shell**, from `backend`. Paste the URL at the `URL:` prompt:

   ```powershell
   $s = Read-Host "URL" -AsSecureString
   $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
   $env:PGSSL_CA = "<PEM from the Backend service>"
   $env:PGSSL_SERVERNAME = "localhost"
   uv run python -c "import os; print(os.environ['DATABASE_URL'].split('@')[1])"
   ```

   The last line must show `*.proxy.rlwy.net:<port>/railway`. If it shows an error or `localhost`, stop.
3. **Look.** `uv run alembic current` gives the production revision. Optional: `uv run alembic upgrade <rev>:head --sql` prints the SQL, without a change.
4. **Better Auth first**, in the same window: `cd ..\frontend\carabao-app; npm run auth:migrate; npm run auth:migrate:apply; cd ..\..\backend`.
5. **Alembic.** `uv run alembic upgrade head`, then `uv run alembic current` must show `(head)`.
6. **Data.** Each script is safe to run again. Run the ones whose table is new or whose data file changed:

   | Script | Table | Without it |
   |---|---|---|
   | `scripts/load_psgc.py` | `psgc_areas` | address saves answer 503 |
   | `scripts/load_psgc_boundaries.py` | `psgc_boundaries` | the pin-area check does not run |
   | `scripts/load_prohibited_terms.py` (`--dry-run` first) | `prohibited_terms` | the word check finds nothing |
   | `scripts/backfill_photo_hashes.py` (`--dry-run` first) | `produces.image_phash` | old photos get no stolen-photo check |
   | `scripts/sync_da_prices.py` | `reference_prices` | no price flags until the API's own sync (every `DA_PRICE_SYNC_HOURS`) |

7. **Roles and guards.** From the repo root: `powershell -ExecutionPolicy Bypass -File backend\db\apply_roles.ps1` (no `-SetPasswords`). Type the database name (`railway`). All checks must be `ok`. **Do this before the deploy.** Until this step runs, the new tables are owned by `postgres` and closed to `carabao_api`. If you see `FAIL carabao_owner is NOLOGIN`, see section 9.
8. **Clean up.** `Remove-Item Env:DATABASE_URL, Env:PGSSL_CA, Env:PGSSL_SERVERNAME`.
9. **Deploy** the API, then the web app. Set any new env vars first (4.1). Then do the post-deploy checks below.

**Rollback:** restore the dump from step 1 (`pg_restore --clean --no-owner` as the superuser), run `apply_roles.ps1`, then redeploy the previous commit.

Windows PowerShell 5.1 breaks double quotes inside native-command arguments, for example `docker run ... sh -c '... -c "SQL"'`. Then `psql` does not get its arguments and tries a local socket (`/var/run/postgresql/.s.PGSQL.5432`). Put the SQL in a mounted file and use `psql -f`, as `backup.ps1` and `apply_roles.ps1` do.

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
   Each line has the directive, the blocked URL and the page, both without query or fragment. Each web process logs at most 60 reports a minute; then one `{"dropped": N}` line tells how many it did not log (CF-0090, `lib/csp-report.ts`). Bodies over 16 KB get 413.
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
    - `shipment_create`: 30 per merchant per hour (CF-0060); each create geocodes stops and calls Mapbox Matrix + Directions
    - `image_upload`: 60 per user per hour across avatar, shop logo, shop banner and produce photo uploads (CF-0060)
    - `voucher_preview`: 30 voucher checks per buyer per hour (CF-0064)
    - `data_export`: 5 personal data downloads per user per hour (CF-0069)
    - `onboarding_submit`: 10 merchant application submits per user per hour, before the documents are scanned or stored (CF-0077)
  - Open unpaid orders: a buyer with `MAX_OPEN_PENDING_ORDERS` (10, `services/order_reservations.py`) PENDING orders gets 409 from place-order until they pay, cancel, or the reservation TTL releases them (CF-0045)
- Better Auth admin plugin HTTP endpoints are blocked (404). Server-side `auth.api.*` calls still work.

### 7.2 Tokens

- **Issuing:** the client gets a JWT from `GET /api/auth/token`. The JWT plugin signs it with EdDSA. It lasts 15 min (5 min from the admin deploy, so a copied admin token dies soon after sign-out). Issuer = `AUTH_JWT_ISSUER` or `BETTER_AUTH_URL` origin, audience `carabao-api`. The payload adds `mfa` (whether the session passed TOTP) and `surface`. The public deploy signs with keys in `jwks`, the admin deploy with keys in `jwks_admin`. The API trusts an admin key only if its thumbprint is in `ADMIN_JWKS_THUMBPRINTS` (SUBDOMAINS.md 1.4).
- **Surface:** the API takes it only from the key set that verified the token. A disagreeing `surface` claim is 401. `/admin/*` needs surface `admin` (see `SUBDOMAINS.md` 1.4).
- **Checking:** the API checks `exp`, `iat`, `sub`, `iss` and `aud`, with 30 s leeway.
  - JWKS unreachable → 503.
  - Invalid token → 401.
- **Live user data:** the API reads name, email, phone, role, ban and 2FA from the `user` table on each request, so a ban works before the token expires. The backend user row is created on first use (`resolve_user`).

### 7.3 Admin 2FA

- Only admins use 2FA, and the admin area and API require it (`mfa_session`; else 403 `ADMIN_MFA_SESSION_DETAIL`).
- **Enrolling** needs a one-time token. Only these actions create one:
  - an invite or a resent invite (`POST /admin/invites`, `/admin/invites/{id}/resend`);
  - an account reset (`POST /admin/admins/{id}/reset`) or a reactivation (`/admin/admins/{id}/reactivate`). Both delete the password and 2FA and send a new invite;
  - `make_admin.py` (prints the link).

  The token's SHA-256 is stored in `verification` as `admin-2fa-enrol-<userId>` and lasts 24 h. The invite email carries it (`/admin/invite?invite=…&token=…`), with an 8-character code that the acting admin gives by another channel. After `POST /admin/invites/accept` (code + new password), the admin signs in and the same token goes in header `x-admin-enrol-token` on `/two-factor/enable`. It is deleted after `/two-factor/verify-totp`. `/two-factor/enrol` sends a signed-out visitor straight to sign-in, with the link as `next`.
- **Disabling:** admins cannot disable 2FA. Another admin resets the whole account (password and 2FA).
- **Password delete:** `carabao_api` has DELETE on `account`, limited by the policy `api_delete_admin_password` to `credential` rows of admin accounts. It has no UPDATE on `account`.
- **Every sign-in method asks for TOTP.** For social or email-link sign-ins, the after-hook drops the session, sets the `two_factor` cookie (10 min) and redirects to `/two-factor`.
- **`session.mfaVerified`** is set at session creation:
  - true via `/two-factor/verify-totp` or `/two-factor/verify-backup-code`;
  - true via a password sign-in that survives because of a trusted device;
  - copied when a session is replaced.
- **Secret endpoints:** `/two-factor/get-totp-uri` and `generate-backup-codes` need `mfaVerified`.
- **Mobile:** admin sign-in from mobile (`expo-origin` header, or `carabaomobile://` / `carabaomerchant://` / `exp://` origin) is refused with `ADMIN_WEB_ONLY`.

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
- **Shop page draft and publish** (`shop_pages`):
  - The merchant edits a draft (`draft_title`, `draft_description`, `draft_logo_url`, `draft_banner_image_url`). `PATCH /merchants/me/shoppage` and the logo and banner uploads change only the draft. Each upload gets a new R2 key, so the live image does not change.
  - `POST /merchants/me/shoppage/publish` copies the draft to the live columns and sets `published_at`. A blank draft title → 422. `POST /merchants/me/shoppage/discard` copies the live columns back to the draft (400 if never published). `POST /merchants/me/shoppage/unpublish` sets `published_at` to NULL, so the farm is hidden again (400 if not live). The draft stays. Open orders continue, because order routes do not use `merchant_is_public()`. Publish makes the farm public again.
  - A merchant is public only after the first publish: `merchant_is_public()` (`services/account_suspension.py`) requires a shop page with `published_at` set. Until then the farm is not in `/merchants`, search, follows or saved produce, and `/merchants/{id}` gives 404.
  - Owner reads: `GET /merchants/me` and `GET /merchants/me/shoppage` (live plus draft, `is_published`, `has_unpublished_changes`). The merchant dashboard uses these, not the public routes.
  - The slug is not part of the draft. A slug change applies at once.

### 7.5 Checkout and payment

1. Checkout creates one order per merchant (`pending`) and holds the stock.
2. The API creates a PayMongo checkout session (`POST /checkout/{order_id}`). The hold and the session last `ORDER_RESERVATION_TTL_MINUTES` (30).
3. PayMongo sends the `checkout_session.payment.paid` webhook. The signature is checked against the secret for the current mode (`te` or `li`).
4. The API compares the amount and currency with the order.
   - **Match:** the order goes to `processing` and the merchant gets an SMS.
   - **Mismatch:** the order goes to `payment_mismatch`, the transaction to `refund_pending`, and an admin is alerted.
5. If nothing is paid within the TTL, the sweep releases the stock and expires the session. If PayMongo shows the session as paid, the sweep settles it instead.

**Vouchers (CF-0058).** Checkout accepts one optional `voucher_code`. A voucher belongs to one farm (`vouchers` table) and takes pesos off that farm's produce subtotal only (not the delivery fee and not other farms' orders). The farm pays for it: `orders.total_price` = subtotal + `delivery_fee` − `discount`, and the payment and the payout use that total. Percent discounts are 1–90 % and are rounded down; a fixed discount is never more than the subtotal. Checks (`services/vouchers.py`, voucher row locked): active, `starts_at`/`expires_at`, `min_subtotal`, `usage_limit`, `per_user_limit`. Each use is a `voucher_redemptions` row; uses on `cancelled` or `payment_mismatch` orders do not count. A code of a farm that is not in the cart gets the same answer as an unknown code. Merchants manage their codes at `/merchants/me/vouchers` (list with use counts, create, `PATCH` — the code cannot change —, `DELETE` only while unused, else 409; at most 50 per farm; another farm's voucher is 404) and on the merchant site page `/vouchers` (CF-0061). Buyers type the code on the web checkout: `POST /orders/me/voucher-preview` shows the discount on the current cart (holds nothing, records nothing; `voucher_preview` limit 30/buyer/h against code guessing), and the code is sent with place-order, which checks it again (CF-0064). Order views carry `discount` and `voucher_code`: buyer (`CurrentOrderResponse`), merchant orders tab (`MerchantOrderResponse`, also `delivery_fee`), admin order list + detail, and the merchant sales CSV (`order_discount`, `order_voucher_code`; lines + `order_delivery_fee` − `order_discount` = `order_total`) (CF-0064, CF-0065). The mobile checkout has the same field, preview and text since CF-0131 (`src/lib/vouchers.ts`; an applied code is dropped when the cart changes). There are no platform-wide vouchers (Needs human: who pays).

**Merchant lists (CF-0073).** The Orders tab (`GET /merchants/me/orders`) returns every paid order that is still open (not delivered, cancelled or payment mismatch), however old, plus the newest `MERCHANT_CLOSED_ORDERS_SHOWN` (200) closed ones. The shipments list returns every shipment with an open order plus the newest `SHIPMENTS_SHOWN` (100) others. A plain "newest N" window would push old open work out of view.
The admin support list (`GET /admin/support`, CF-0076) is built in one SQL query plus 2 batch reads (last messages, users): unanswered conversations first, then the most recent, `limit` (default 100, ≤ 200) and `offset`.

**Listing page (CF-0081).** `GET /produce/{id}` (public, same per-IP limit as search; declared after `/produce/search`, which Starlette would otherwise read as an id) returns a listing buyers can order, its farm (name, town, rating, holiday mode — no address or contact) and up to 10 listings with the same name (case and spaces ignored) from other public farms, cheapest first; 404 for hidden, expired, suspended-farm or missing listings. Web page `/listings/[id]` (a buyer path in `BUYER_PREFIXES`; `/produce` is a merchant-site page); produce search cards open it, and it links to the farm page to order.

**Cart lines (main CF-0052 + web loop CF-0042, joined 2026-11-20).** `GET /carts/me` builds each saved line again from its listing (price tier, stock, name, farm), writes the fresh lines back, and drops lines whose listing was deleted. Each line has `unavailable_reason` (text, for example "is no longer available"; the web cart and the mobile app show it) and `issue` (a code: `unavailable`, `expired`, `farm_unavailable`, `own_listing`, `below_minimum`, `exceeds_stock`). Stock is only a code: `unavailable_reason` stays null for `exceeds_stock`. `previous_price` is the price when the buyer last saved the line, if the listing price changed since; it stays until the next `PUT`. `PUT /carts/me` refuses (400) a new or changed line that checkout would refuse; a saved line that goes bad later is kept and flagged. Both forms come from one check (`cart_line_issue` in `routes/_order_helpers.py`). Place-order takes optional `produce_ids` (only the ticked lines) and `voucher_code`.

**Order history removal (CF-0070).** `DELETE /orders/me/history/{id}` (closed orders only) sets `orders.hidden_by_buyer_at`; it never deletes the row. The buyer's history lists (`/orders/me/history`, `/page`) leave hidden orders out; the order detail link, the receipt, the farm's and the admins' views, payments, refunds, reviews and the buyer's data export keep them. Orders with payments can now be hidden too (the old 409 stopgap is gone).

**Holiday mode (CF-0066).** A merchant can pause orders through a day (`PUT /merchants/me/pause` `{paused_until, message}`, today … today + 90 days on the Manila calendar; `DELETE` resumes). The farm stays listed and visible (public responses carry `paused_until` and `pause_message`), but `merchant_takes_orders` is false, so place-order refuses its lines ("… is on a break and takes orders again after …"), the cart flags them `farm_unavailable`, and reorder skips them. It ends by itself the day after `paused_until`; no job clears it. Orders placed before the pause are not changed. Web: merchant Shop & settings → Holiday mode (the old `/settings` path opens `/shop`); a notice on the farm page; an "On a break until …" label on browse farm cards (slim list `paused_until`) and produce search results (`merchant_paused_until`, CF-0072). The voucher preview leaves a paused farm's lines out, like checkout.

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
- PSGC address check (`services/psgc.py`, table `psgc_areas`, data `app/data/psgc.csv`). Saved addresses (`/users/me/addresses`), onboarding (`/merchant-onboarding/me`) and `PATCH /merchants/me` send region, province, city and barangay as names, or as PSGC codes (`region_code` ... `barangay_code`, 10 digits; a code wins over a name). The server finds each level under its parent, stores the PSGC names and the codes, and takes the region (and so the Luzon check) from the PSGC row. 400 for a level not in its parent or outside Luzon (onboarding: `FieldErrors` under the field). NCR: province "Metro Manila", no `province_code`; its cities are under the region. The barangay is required when the city has barangays in the list (City of Manila has none; its districts do). A PATCH takes names it does not send from the stored row, and never reuses stored codes. A saved address can still have no area at all (pin only). Postal code: 4 digits; a blank one is filled from the city when the list has one; it is not compared with the city, because psgc.cloud has gaps and errors (San Nicolas, Manila shows 9503). Checkout: `delivery_address_id` (a saved address of the buyer) makes the server take the address text, the area and the pin from that row; `delivery_address`, `delivery_region`, `delivery_lat`, `delivery_lng` and `delivery_pin_confirmed` must then be left out (422). Without it the old path stays (client `delivery_region`, B2). Refresh the data: `uv run python scripts/fetch_psgc.py` (about 17 min; psgc.cloud allows 120 requests a minute), review the diff, then `scripts/load_psgc.py`. Empty table: 503 and a log line. (2026-11-24: psgc.cloud also returned all NCR cities in Sarangani's list; the script now skips a city whose code does not start with its region's 2 digits.)
- Pin-area check (`services/pin_area.py`, table `psgc_boundaries`, data `app/data/psgc_boundaries.jsonl.gz`). No PostGIS (the Railway image `postgres-ssl:17` does not have it): Luzon city and barangay polygons are stored as WKB with a bounding box, keyed by PSGC code, and tested with shapely in local metres. On save of a saved address, onboarding and `PATCH /merchants/me` (only when the pin or the area changes): pin within 200 m of the city and the barangay: `pin_area_mismatch = false`; outside, but at most 5 km from the city: saved with `pin_area_mismatch = true` and a log line `pin_area mismatch` (codes and distances only, no coordinates or address text); more than 5 km from the city: 400 `This pin is N km outside {city}. It is in {found city}...` (onboarding: under `pin`). No pin, no city code, or no polygon for the city: `pin_area_mismatch = NULL` (not checked). Source: github.com/faeldon/philippines-json-maps release v1.1.1 (MIT, PSGC 3Q 2026), medium resolution; 712/712 Luzon cities and 19005/19061 barangays have a shape. Refresh: `uv run python scripts/fetch_psgc_boundaries.py` (checks SHA256SUMS), then `scripts/load_psgc_boundaries.py`. Checkout without `delivery_address_id` sends no codes, so it is not checked.
- Address writes: rate limit and change log (`services/address_log.py`, table `address_change_logs`, migration `a9d3f5b7c1e8`). Saved address create, PATCH and delete, and `PATCH /merchants/me` when it sends a location field, count against `address_write` (30 an hour per user; 429 with Retry-After). A change to the pin or the city/barangay adds one row: user, target (`user_address` or `merchant`) and id, action, old and new city and barangay codes, `pin_change` (`set`, `moved`, `cleared`) and `pin_moved_m`. No coordinates and no address text. Label, recipient or street edits and a re-sent pin (under 1 m) add no row. Rows older than 180 days are deleted in the main.py cleanup loop. Onboarding is not logged (it has its own limit, and an admin reviews each application).
- Address text cleaning (`app/schemas/text.py` `one_line`, a `mode="before"` validator). Saved address label, recipient and area fields, shop and onboarding area fields, and checkout `delivery_address` / `delivery_region`: control characters removed (tab and line breaks become a space), format characters (zero-width, BOM, bidi overrides), private-use and unassigned code points removed, NFC, whitespace runs collapsed to one space. The length limits apply to the cleaned text, so a value of only hidden characters is empty.
- Pins with no road check (`services/pinned_location.py`). When the road service is down, a pin is saved with no road point (fail open) and the log gets `road check skipped` (no coordinates). No extra column: such a pin has `lat` but no `road_lat` (`needs_road_check`). The check runs again: at checkout for the saved address used (a road found is stored on that address), at shipment creation for the merchant pin and each stop's pin (`recheck_roads`; a road found is stored; no road near the pin: the stop is still routed, with `pin_no_road = true` and a warning to the rider), and in the sweep `uv run python scripts/recheck_road_pins.py [--limit N]` (saved addresses, merchants, applications, open orders; prints row ids, never coordinates). A saved pin with no road is refused at its next checkout or save.
- Verified pins (`pin_verified_at` on `user_addresses`, migration `f8a2c4e6b0d9`). Only the server sets it: `mark_delivered` calls `mark_pin_verified`, which marks the buyer's saved addresses within 10 m of the delivered pin, unless a rider reported that order's pin. Moving the pin by 1 m or more clears it; the API refuses it from a client (422, `extra="forbid"`). Each route stop gets `pin_verified` (a verified saved address, or an earlier delivered and not reported order, within 10 m). The rider sees "Verified pin" on web and mobile. `pin_confirmed` still only means the person placed the pin.
- Pin notice. Every map pin picker (web `components/MapPinPicker`: checkout, profile addresses, onboarding, store details; merchant app `AddressPinMap`) shows "Place an accurate pin" above the map: riders go to the pin, not to the address text.
- Listing guardrails, Phase 1 (`services/listing_checks.py`, spec `documentation/PRODUCE_GUARDRAILS_SPEC.md`). One checker for all clients: `POST /produce/check` (merchant, saves nothing, `produce_check` limit 120/min) while the form is typed in (web and merchant app wait 400 ms), and again on `POST /produce/` and `PATCH /produce/{id}`. A **hard block** refuses the save with 400 `FieldErrors` (contact details and off-platform payment, `prohibited_terms` hard words, duplicate name + unit in one farm, dates, price tiers). A **soft flag** saves the listing as `under_review` (payment name alone, soft words, keyword spam, category mismatch, shelf life, unknown produce only when the reference prices are not SAMPLE rows). `produces.status`: `live` | `under_review` | `rejected` | `hidden` (follows `hidden_at`). Buyers see and can order `live` and `under_review` (`is_listed`, `is_withdrawn`); `rejected` is not shown. Edits (Phase 1): a rejected listing goes back to `under_review`; an `under_review` listing goes live when the edit clears every flag; a live listing follows the Phase 2 rules below. Admin queue: `/admin/listings?show=under_review` (`GET /admin/produce?status=under_review`, oldest first), `POST /admin/produce/{id}/approve` and `/reject` (`code` from `GET /admin/produce/rejection-codes`; `OTHER` needs a note of 10+ characters), audit `produce.approve` / `produce.reject`, merchant notifications `listing_approved` / `listing_rejected` (open `/produce`). Word list: table `prohibited_terms`, admin page `/admin/terms` (`/admin/prohibited-terms`; no delete, turn off instead; the checker caches it for 60 s per worker). Load it with `uv run python scripts/load_prohibited_terms.py --dry-run`, then without `--dry-run` (reads `documentation/plans/carabao_produce_guardrail_wordlist.md`; line ranges set the severity; prints counts only, never a word; adds new words only). Not in Phase 1 or 2: farm size check (no farm size is collected), price flags, image checks.
- Listing guardrails, Phase 2 (`services/listing_trust.py`, migration `a4c6e8f0b2d5`). **Check again after edits:** an edit to name, description, category, photo (`POST /produce/{id}/image` too), or a price change of more than 30% is material; a live listing with a material edit goes to `under_review` when the check has a soft flag. Stock or date edits only keep the status (hard blocks still run on every save). **New farms:** until an admin approved 3 listings of the merchant (`produces.approved_at`, set on the first approve, never cleared; rejected listings do not count), each new or materially edited listing goes to `under_review` with the flag `NEW_MERCHANT_REVIEW`. **Penalty points:** an admin rejection gives points by reason (`PROHIBITED_COMMODITY` 3, `CONTACT_INFO` 2, `SPAM` 1, `MISLEADING_PHOTO` 1, others 0; shown in `GET /admin/produce/rejection-codes`). Rows in `listing_penalties` count for 28 days. At 3 points `POST /produce/` returns 403 (edits still work) and the merchant gets `listing_blocked`; at 6 points every admin gets `merchant_account_review` (link `/admin/penalties?merchant_id=`), and an admin decides to suspend with the current suspend action (no automatic suspension). A flag the merchant corrects before an admin acts gives no points (no rejection). Merchant: `GET /merchants/me/listing-standing` (banner on web `/produce` and the app Produce tab; the add button is off while blocked). Admin: page `/admin/penalties` (`GET /admin/penalties/accounts`, `GET /admin/penalties`, `POST /admin/penalties/{id}/revoke` with a reason of 5+ characters; audit `listing_penalty.revoke`; merchant notification `listing_penalty_revoked`).
- Listing guardrails, Phase 3 (`services/listing_reports.py`, migration `b6d8f0a2c4e7`). **Buyer reports:** a signed-in user reports a listing that buyers can see with `POST /produce/{id}/report` (`reason` from `GET /produce/report-reasons`; `OTHER` needs a note of 10+ characters; `listing_report` limit 10/hour per user; 404 for a listing buyers cannot see, 400 on your own listing, 409 when you have an open report on it). Rows go in `listing_reports` (one open report per user and listing). A `live` listing goes to `under_review` with one `BUYER_REPORT` flag that counts the open reports; the first open report sends `listing_reported` to every admin (link `/admin/listings?status=under_review`). The merchant sees the flag but not the reporter or the note. A merchant edit keeps the flag while a report is open. `GET /admin/produce` returns `open_reports` (reason, note, reporter id); approve, reject or hide closes them (`resolution` approved | rejected | hidden). Web: "Report this listing" on `/listings/{id}`; the buyer app has no listing page yet. **Chat filter:** buyer and farm messages in order chat and shop inquiries get the listing contact check (`listing_checks.chat_message_problem`): a phone number, email, link, social media contact or off-platform payment instruction gives 422 with the reason. Admin and support messages are not checked. Not in Phase 3: the review "not as described" flag.
- Listing guardrails, Phase 4 (`services/photo_checks.py`, `services/listing_vision.py`, price flags in `services/listing_checks.py`, migration `e9a1c3b5d7f2`). **QR code (hard block):** `POST /produce/{id}/image` decodes the re-encoded photo with zxing-cpp; a QR code gives 400 `FieldErrors` on `image` before R2. **Stolen photo (soft flag):** the upload saves a 64-bit pHash in `produces.image_phash`; a photo within 6 bits of another farm's listing photo gives `POSSIBLE_STOLEN_PHOTO` (the same farm may use its photo again). Removing the photo clears the hash. Photos uploaded before Phase 4: `uv run python scripts/backfill_photo_hashes.py --dry-run`, then without `--dry-run`. **Price flags (soft):** the reference is the NCR retail price (the farms deliver to NCR). Price per kg (`unit_quantity` counted; listings are kg only, the schema refuses `lbs` with 422) below 0.3 x `low` gives `PRICE_TOO_LOW` (base price or a tier), above 2 x `high` gives `PRICE_TOO_HIGH`; a farm price of 40-60% of retail gets no flag. Only real (not SAMPLE), per-kg rows count: DA rows at most 45 days old, in-house rows at most 180 days. `POST /produce/check` returns `market_price` (low, high, source, `recommended_max` = low, `price_per_kg`); the web and merchant mobile forms recommend `recommended_max` or less. **Source** (`services/da_price_sync.py`): the DA Price Index API (`DA_PRICE_API_URL`, `GET /prices/latest?region=NCR`). Produce categories only, per kg, available, not drift flagged; DA variants become one row per produce (low = lowest variant, high = highest) with curated Tagalog/Bisaya aliases. Then the in-house rows from `app/data/inhouse_reference_prices.csv` (produce DA does not list, source `Carabao in-house ...`; a DA or kept admin row with the same name wins). The sync replaces SAMPLE, DA and in-house rows and keeps other admin CSV rows. Fewer than 20 DA groups or an API error: nothing changes. **When:** the `main.py` background loop calls `sync_if_due` every `DA_PRICE_SYNC_HOURS` (default 6, 0 = off; the newest `reference_prices.sync_da` audit row is the clock; an advisory lock stops two workers). Now: `POST /admin/reference-prices/sync-da` or `uv run python scripts/sync_da_prices.py`. Admin: `GET /admin/reference-prices/status` (`price_flags_active`), `POST /admin/reference-prices/import` (CSV, same columns as `app/data/reference_prices.csv`, max 1 MB; one bad line and nothing changes; audit `reference_prices.import`; it replaces the whole table, so run the sync after it). Known API problem: DA Eggplant comes as unit `pc` (parser), so the in-house Eggplant row is used until DA gives it per kg. **Vision check (advisory):** after the save, a background task sends the photo of an `under_review` listing to `claude-haiku-5-5` (structured output) once per photo, name and category, and stores the answer in `produces.photo_check`. It adds `VISION_MISMATCH` (photo does not show the named produce) or `VISION_CONTACT_TEXT` (contact or payment details in the photo); it never rejects or makes a listing live. Admin approve sets `cleared`, so the flags do not come back. `GET /admin/produce` returns `photo_check`. Only photos under `CLOUDFLARE_R2_PUBLIC_URL` are downloaded. Not in Phase 4: local OCR, admin and merchant UI for the new flags beyond the generic flag list.
- Review moderation (CF-0075, `routes/admin_reviews.py`, admin page `/admin/reviews`): `GET /admin/reviews` (paged; `hidden`, `max_rating`, `merchant_id`, `q` on the comment), `POST /admin/reviews/{id}/hide` (reason required) and `/unhide`, each with an audit row (`review.hide` / `review.unhide`). A hidden review stays in the database and in the buyer's own views and data export, but leaves the public farm list, the farm's own list and counts, and `merchants.rating` (recomputed). Hiding keeps `updated_at` (it marks the buyer's edits). The farm cannot reply to a hidden review (404). The author's own `ReviewResponse` has `hidden: true` (not the reason), and the order detail page says so (CF-0078).
- Personal data export (CF-0069, `services/data_export.py`, `GET /users/me/export`, web profile → "Download my data"): one JSON file with the caller's account, addresses, orders + their payments, reviews written, followed farms, saved produce, the messages they sent, their in-app notifications (CF-0073), and their own farm profile. Not included: other people's personal data (the other side of an order is the farm name only), other people's messages, payout account numbers, TIN, RSBSA numbers. Keep this list in step when a new table holds personal data.
- Security headers on every API response (CF-0068, `app/core/security_headers.py`, inside CORS and outside the request-ID and body-limit middleware, so 413 and 500 get them too): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` (not on the development-only `/docs`, `/redoc`, `/openapi.json`). A request with `Authorization` or the internal secret header gets `Cache-Control: no-store`. A header a route sets itself is kept. HTTPS requests (scheme or the first `X-Forwarded-Proto` value) also get `Strict-Transport-Security: max-age=63072000` (CF-0077; no `includeSubDomains` — the web app sets that on the root domain; browsers ignore HSTS on plain HTTP).
- Mapbox calls (`utils/geocoding.py`, `services/mapbox_routing.py`) log only the HTTP status or the exception type (CF-0059). They never log the address, the coordinates or the exception text: the text of a `requests` error can contain the URL with `access_token`, and addresses are buyers' home addresses. `app/` has no `print()` left. Use a module logger. SMS and email provider errors (CF-0071): `SemaphoreError` texts hold the HTTP status and field names only, never values (Semaphore's error answers can repeat the number and the message, which can be an OTP or an admin setup link); log other provider errors with `app.core.errors.describe_error(exc)` (the type only), not `%s, exc`. Database errors (CF-0074): `create_db_engine` sets `hide_parameters=True`, so SQLAlchemy error texts and tracebacks show the SQL without its values. PayMongo transfer errors: logs write the batch id and `exc.codes` (PayMongo error codes / HTTP status) only; the full detail, which can repeat the destination account, goes to the batch `failure_reason` for admins. Phone numbers, emails and addresses (CF-0087): log calls in `app/` pass none of them; mask a number as `number[-4:]` when the log must tell numbers apart. `tests/test_no_pii_in_logs.py` reads every `logger.*(...)` call in `app/` and fails on an argument whose name has `phone`, `number`, `email`, `address` or `recipient` in it (a `[-4:]` slice is allowed).

### 7.10 OTP storage (API-owned codes)

- `otp_codes` stores only `HMAC-SHA256(AUTH_SYNC_SHARED_SECRET, key + code)`.
- TTL 600 s, resend cooldown 60 s, max 5 attempts.
- Used for merchant contact-number codes and payout destination codes.
- Better Auth stores its own account phone codes.

---

## 8. Maintenance

### CF IDs

Code comments and test names use `CF-00NN` tags. Some numbers have two meanings, because work on `main` and on `improve/loop` took IDs at the same time:

- **CF-0039 to CF-0054:** `main` and the web loop use these numbers for different changes. Examples: CF-0042 is "listing input limits" on `main` and "cart line issues" in the web loop. CF-0052 is "cart line check" on `main` and "farm page hearts" in the web loop. Read the comment text, not only the number.
- The old branch `fix/cf-0039-0044` used CF-0039 to CF-0044 too. `main` has its own version of those fixes, so the branch is not merged.
- **Ranges from now on**, so the two loops can run at the same time:
  - web (and `main`): CF-0085 to CF-0100, then CF-0200 to CF-0299, then CF-0400 and up.
  - mobile loop: CF-0101 to CF-0199 (last used CF-0131), then CF-0300 to CF-0399.
  - Find the highest used number with `grep -rhoE "CF-0[0-9]{3}" backend frontend mobile/CarabaoMobile/src mobile/CarabaoMobile/app mobile/CarabaoMerchantMobile/src mobile/CarabaoMerchantMobile/app | sort -u`.

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

- **API tables:** add an Alembic revision in `backend/alembic/versions`. When two branches each add revisions, add an empty merge revision with both heads as `down_revision` (example: `f5b7d9e1a3c6` joins `main` and `improve/loop`). `uv run alembic heads` must show one head. Alembic excludes `user`, `session`, `account` and `verification` (`alembic/env.py`).
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
| a production migration shows "already at head" or "already up to date", but production is not | `DATABASE_URL` empty in the shell, so `.env` (localhost) was used | set it again and check the host (6, "Updating production", step 2) |
| `Could not parse SQLAlchemy URL` / "The Postgres URL could not be parsed" | the shell's `DATABASE_URL` is not a URL (wrong text at the prompt) | set it again |
| `password authentication failed for user "postgres"` on `*.proxy.rlwy.net` | the password changed; old URL | copy `DATABASE_PUBLIC_URL` again |
| API `permission denied for table …` after a migration | new table owned by `postgres` | `apply_roles.ps1` (6, "Updating production", step 7) |
| `apply_roles.ps1`: `FAIL carabao_owner is NOLOGIN` | `LOGIN` left on after a migration | as the superuser: `ALTER ROLE carabao_owner NOLOGIN PASSWORD NULL;`, then run the script again |
| `backup.ps1` restore: role "carabao_…" does not exist | old `backup.ps1` | update it; it creates the four roles in the scratch server |
| `psql` tries socket `/var/run/postgresql/.s.PGSQL.5432` in `docker run` | PowerShell 5.1 broke the quoted arguments | SQL in a mounted file, `psql -f` (6, "Updating production") |
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
