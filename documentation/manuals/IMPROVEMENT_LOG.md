# Improvement Log
branch: improve/loop    push: no    iteration: 4

## In progress
(none)

## Kind balance (count / last iteration #)
FEATURE 1/#4 · STRENGTHEN 1/#2 · SECURITY 1/#3 · AUDIT 1/#1

## Needs human
- Push policy: header says `push: no`. Change to `yes` if the loop should push `improve/loop`.

## Backlog (highest impact÷effort first)
| id | kind | size | impact | effort | area | epic | item — acceptance test |
|----|------|------|--------|--------|------|------|------------------------|
| B02 | SECURITY | M | 4 | 2 | produce schemas | | `ProduceBase.unit_quantity` has no bounds (0 or negative accepted → divide-by-zero / negative per-unit math); `name`/`description` have no `max_length`; schemas lack `extra="forbid"`. Add bounds + forbid on produce, review, shop page, shipment, payment schemas — test: `unit_quantity=0` → 422, 10k-char name → 422, unknown field → 422. |
| B03 | SECURITY | M | 4 | 2 | rate limits | | No rate limit on review create/update, order chat send, support chat send, or `/produce/search` (only OTP/SMS/onboarding/merchant phone use `services/rate_limit.py`). Add per-user (per-IP for search) limits — test: N+1th request → 429 with standard error body. |
| B04 | STRENGTHEN | M | 4 | 2 | orders API + profile UI | | `GET /orders/me/history` loads every order and sorts in Python, no pagination. Move to SQL `ORDER BY ordered_at DESC` with `Page[...]` (limit/offset, status filter, search by order ref) + UI pager — test: 25 orders, page_size=10 → 3 pages in order. |
| B05 | FEATURE | L | 5 | 4 | checkout/money | promos | Voucher/promo codes: model + Alembic, admin CRUD, server-side validation in checkout pricing via `services/money.py` (percent/fixed, min spend, usage cap, expiry, merchant- or platform-scoped). Slice 1: model + validation service + apply at place-order with tests. |
| B06 | FEATURE | M | 4 | 3 | discovery | wishlist | Saved produce (wishlist): `saved_produce` table + Alembic, `POST/DELETE/GET /me/saved-produce`, heart button on produce cards, saved list on profile — test: save, list, unsave; hidden listings excluded. |
| B08 | FEATURE | M | 3 | 2 | SEO | seo | Extend `app/sitemap.ts` beyond `/` and `/farms/:id`: category/search landing pages and help pages; add lastModified from farm `updated_at` — test: pure sitemap builder unit test. |
| B09 | FEATURE | M | 4 | 3 | post-purchase | | Printable receipt/invoice view for a paid order (print CSS page using existing `receipt` model) reachable from order detail — test: owner gets 200, other buyer 404. |
| B10 | STRENGTHEN | M | 3 | 3 | orders model | | Order history delete hard-deletes the order (comment: "stopgap until history uses a hide flag") and refuses orders with payments (409). Add `hidden_by_buyer_at` + Alembic, filter it out, keep the row — test: paid order can be hidden, still visible to merchant/admin. |
| B11 | FEATURE | M | 3 | 2 | reviews | | Merchant reply to reviews (one reply per review, editable, shown publicly) — test: only the reviewed merchant can reply; others 403/404. |
| B12 | FEATURE | M | 3 | 3 | merchant tools | | Merchant sales report CSV export (reuse admin_transactions CSV helpers) — test: CSV header + rows scoped to the merchant. |
| B13 | FEATURE | M | 3 | 3 | merchant tools | | Store holiday mode: merchant toggle that flags/hides listings and blocks checkout for that merchant — test: cart line from a paused merchant is rejected at place-order. |
| B14 | FEATURE | M | 3 | 2 | cart | | Price/stock change warnings in cart: cart response flags lines whose price changed since add or exceed stock — test: lower stock below qty → line flagged. |
| B15 | STRENGTHEN | M | 3 | 2 | tests | | Routes with no dedicated tests: `carts.py`, `chat.py` (partly via order_chat), `misc.py`, `payments.py`, `users.py`, `email.py`, `email_otp.py`, `admin_produce.py` (via listing_moderation?). Add IDOR/ownership tests per route — test: cross-user access → 404/403. |
| B16 | SECURITY | M | 4 | 3 | authz | idor | Route-by-route IDOR sweep with a cross-user test for every `{id}` route (orders, shipments, tracking, chat, reviews, addresses, merchant produce). |
| B17 | FEATURE | M | 3 | 3 | account | | Notification preferences per channel (SMS/email/in-app) respected by `services/notifications.py` and `sms_service.py` — test: opted-out channel not sent. |
| B18 | FEATURE | M | 3 | 3 | account | privacy | Personal data export (JSON download of profile, addresses, orders, reviews) — test: export contains only own data. |
| B19 | FEATURE | M | 3 | 3 | discovery | | Recently viewed produce/farms (client-side, localStorage with try/catch) + "other farms selling this" on produce detail — test: pure helper unit test. |
| B20 | STRENGTHEN | M | 3 | 2 | web tests | | Web pure-logic test coverage: only 8 test files in `npm test`. Add tests for `util/errorHelper.ts`, `lib/seo`, status helpers — registered in `npm test`. |
| B21 | FEATURE | M | 3 | 3 | admin | promos | Admin voucher management UI (after B05). |
| B22 | FEATURE | M | 3 | 3 | admin | | Admin moderation queue for reviews (hide/restore with audit log) — test: hidden review excluded from public list; audit row written. |
| B23 | FEATURE | M | 2 | 3 | merchant tools | | Bulk produce edit / CSV import-export for merchants — test: CSV round-trip. |
| B24 | STRENGTHEN | M | 2 | 3 | web refactor | | Largest files are refactor candidates: `api/routes/merchants.py` (1170 lines), `api/routes/admin.py` (775), `lib/auth.ts` (767), merchant onboarding page (705). Split merchants.py into produce / shop page / payouts modules without behaviour change. |
| B25 | STRENGTHEN | M | 3 | 2 | CSP | | Progress toward `CSP_ENFORCE=true`: inventory report-only violations and remove them. |
| B26 | FEATURE | S | 2 | 2 | mobile | parity | Mobile parity backlog: wishlist, vouchers, order history pagination once the web versions land. |
| B27 | STRENGTHEN | M | 3 | 2 | lint | | Ruff to green, 142 left: 130 E501 (28 in HTML strings in `services/email.py`, 23 in `scripts/seed_demo.py`, ~45 across app routes/services), 4 E402 in scripts, 2 F811 from importing the autouse `_env` + `transfers` fixtures of `test_payouts.py` (move into a payouts plugin applied only via `pytestmark = pytest.mark.usefixtures`), misc I001/UP017/UP046/B905 — test: `uv run ruff check .` exits 0. Do not use `ruff format` wholesale (24 app files would reformat). |
| B28 | STRENGTHEN | L | 2 | 4 | types | | Mypy 2391 errors, mostly untyped test helpers; slice by directory (app/ first) — test: `uv run mypy app` exits 0. |
| B30 | STRENGTHEN | S | 3 | 1 | tests | | Audit other env leaks from a local `.env` into tests (anything `load_dotenv` sets that code reads at call time: PAYMONGO_*, R2_*, SEMAPHORE_*, RESEND_*) — test: pytest passes with a `.env` full of dummy values. Batch with B20. |
| B31 | SECURITY | S | 3 | 1 | data | | Image URLs stored before CF-0034 may point off-site; a one-off check script listing produce/shop rows whose image URLs don't start with `CLOUDFLARE_R2_PUBLIC_URL` (report only, no auto-delete) — test: script unit test on a seeded SQLite db. Batch with B02. |
| B32 | FEATURE | S | 2 | 1 | SEO | seo | Validate the farm page JSON-LD with Google's Rich Results Test on a deployed farm, and add `BreadcrumbList` (Home › Farms › farm) — test: builder unit test. Batch with B08. |
| B33 | FEATURE | S | 2 | 1 | mobile | parity | Mobile has no SEO surface; no parity needed for B07 (log only). |
| B29 | SECURITY | M | 4 | 2 | deps | | `npm audit --omit=dev` 13 vulns (2 critical): apply patch/minor upgrades (sharp etc.), log majors — test: audit count drops, build passes. |

## History (newest first; keep last 30, summarize older ones in one line each)
### #4 — FEATURE — web SEO (farm pages) — CF-0035 — M
What: farm pages (`/farms/[id]`) now render a schema.org JSON-LD `@graph`: the farm as `LocalBusiness` (name/description/banner from the shop page, locality/province/postal code/PH only — no street, pin or contact, on purpose), `AggregateRating` only when `rating_count > 0` (rounded to 1 dp), and each listed produce item (max 30, named and priced) as a `Product` with a PHP `Offer` (InStock/OutOfStock, `UnitPriceSpecification` with KGM/LBR) whose seller is the farm. Pure builder `lib/structured-data.ts`; page reuses the cached `getPublicFarm` from `generateMetadata` (no extra API call). `serializeJsonLd` escapes `<`, `>`, `&`, U+2028/2029 so merchant text can't close the `<script>`. Added `rating_count` to the web `Merchant` type (API already sends it). Why: B07, rich results for farm/produce searches. Tests: `lib/structured-data.test.ts` (8, registered in `npm test`): address privacy, shop page overrides, rating rules, Product/Offer shape, out-of-stock/lbs/invalid items, cap, non-http images dropped, script-breakout escape round-trip. Checks: web test 59/59, lint, tsc, `npm run build` pass; backend pytest 676 passed, ruff 142 / mypy 2348 (unchanged, pre-existing). Docs: SYSTEM_REFERENCE §2 key files. Follow-ups: B32, B33.
### #3 — SECURITY — produce + shop page API — CF-0034 — M
What: JSON bodies can no longer set image URLs. New `upload_validation.check_image_url_fields`: on `POST /produce/` `image_url` must be empty; on `PATCH /produce/{id}` and `PATCH /merchants/me/shoppage`, `image_url` / `banner_image_url` / `logo_url` may only be sent unchanged (the web edit form posts the stored URL back) or cleared (`null`/`""` → `None`); anything else → 400 `FieldErrors` naming the field. Only the upload routes (validated, re-encoded, R2) write these. Also typed `field_errors_handler` (fixes a mypy error at `main.py` registration). Why: B01 — a merchant could point a listing every buyer loads at a tracking pixel or off-site URL. Tests: `tests/test_image_url_fields.py` (11: create refused for off-site/`javascript:`/relative, create without image ok, edit can't repoint, edit can send stored URL back, edit can clear, shop banner+logo refused, shop keep/clear ok). `/security-review` on the diff: no findings ≥ 8 confidence; confirmed no other write path (ShopPageCreate has no image fields, admin routes don't write them). Checks: pytest 676 passed; ruff 142 (unchanged, all pre-existing); mypy 2351→2348; web test/lint/tsc pass. Mobile never sends image URLs. Follow-ups: B31.
### #2 — STRENGTHEN — backend tests — CF-0033 — M
What: fixed the 2 failing JWKS tests (B00) and cleared 137 of 139 ruff F811. Root cause of the failures: `load_dotenv()` copies `PUBLIC_JWKS_URL`/`ADMIN_JWKS_URL` from a developer `.env` into the test process, so key-set URLs pointed at localhost; new autouse `_jwks_urls` fixture in `tests/conftest.py` clears them. F811: moved the shared `db`/`merchant`/`buyer` fixtures (+ `_buyer`, the SQLite JSONB compile hook) out of `test_reviews.py` into `tests/shared_fixtures.py`, loaded via `pytest_plugins`, and dropped the fixture names from 39 modules' imports. Why: broken-first; and the suite was only green on machines without a `.env`. Tests: full pytest 665 passed (was 663 + 2 failed). Checks: pytest pass; ruff 282→142 (rest pre-existing, B27); mypy 2391→2351 (no new errors; new module fully typed); web test/lint/tsc pass. Follow-ups: B27 (rest of ruff), B30.
### #1 — AUDIT — whole codebase — (no CF) — M
What: created this log and `improve/loop` branch; surveyed routes, services, schemas, tests, SEO, web/mobile; wrote a 26-item backlog. Why: no state file existed. Tests: baseline checks run (see Health). Checks: see Health. Follow-ups: start with B01/B02 (SECURITY) then B05 slice 1 (FEATURE).
New from code reading (not from §2): B01 image_url mass assignment, B02 unit_quantity unbounded, B04 unpaginated Python-sorted history, B10 hard-delete stopgap, B24 oversized modules, B03 missing limits on chat/reviews/search.

## Health (refreshed on AUDIT)
Baseline 2026-11-18, before any loop change (all failures below are pre-existing):
- Backend pytest: 663 passed, **2 failed** — `test_auth_identity.py::test_jwks_outage_is_503_not_401` and `::test_unknown_key_id_is_401`, `KeyError: 'http://localhost:3001/api/auth/jwks'` (the test's fake JWKS map is keyed by a URL that doesn't match the configured one, probably env-dependent). See B00.
- Ruff: **282 errors** (139 F811 redefined-while-unused, 130 E501, 6 I001, 4 E402, …). Mypy: **2391 errors in 175 files** (mostly tests, `no-untyped-call`). Loop rule for now: no *new* ruff/mypy errors in touched files; whole-repo green is backlog B27/B28.
- Web: `npm test` 51/51 pass; `npm run lint` clean; `tsc --noEmit` clean.
- `npm audit --omit=dev`: 13 vulnerabilities (3 moderate, 8 high, 2 critical), incl. `sharp`/libvips CVEs. Patch/minor upgrades → B29.
- Largest files: `backend/app/api/routes/merchants.py` 1170, `admin.py` 775, `lib/auth.ts` 767, merchant onboarding page 705, merchant shell page 559.
