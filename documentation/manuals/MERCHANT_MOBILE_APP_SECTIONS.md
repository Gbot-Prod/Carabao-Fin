# Merchant Centre on mobile: runnable sections (companion to MERCHANT_MOBILE_APP_PLAN.md)

Status: working checklist, 2026-11-23. `MERCHANT_MOBILE_APP_PLAN.md` ("Plan 2") stays the
source of truth for *what* the app must do; this file only splits it into sections that can be
executed and verified one at a time, in this order. Do not reorder sections without rereading
§5 (the dependency line of each section) and §6 (traceability).

## 0. How to use this file

- Do one section per task. Never start the next section with a failing check.
- Give the agent **§0, §1, §2 and the one section** each time. The rules below and plan §1-§2
  apply to every section; the section text does not repeat them.
- Paths: `MM/` = `mobile/CarabaoMerchantMobile/`, `W/` = `frontend/carabao-app/`,
  `M/` = `W/app/(site)/(merchant)/merchant/`.
- "Verify" commands are written for PowerShell. "The three checks" means, in `MM/`:
  `npx tsc --noEmit; npm run lint; npm test`. All three must pass.

**Rules for every section** (plan §1 and §2, short form)

1. No `backend/` changes. No changes in `mobile/CarabaoMobile` (buyer) or `W/`. If an
   endpoint seems missing, stop and write it under "Open questions" in `MM/README.md`.
2. The web code is the spec. Read the web files the section names. Copy the rules
   (validation, limits, labels, error text). Do not invent behaviour the web does not have.
3. Pure logic goes in `MM/src/lib/*.ts` with a `*.test.ts` next to it (`node --test`,
   `.ts` import suffixes, no `react-native` import). Screens go in `MM/src/screens`. Files in
   `MM/app/` are 1-line re-exports (plus `options` when a header setting is needed).
4. Every new endpoint call goes in `MM/src/lib/api.ts`, with a response type copied from
   `W/util/api/*.ts` or `backend/app/schemas/*.py`.
5. A value that must match the web or backend gets a test in `MM/src/lib/inStep.test.ts`
   that reads the source file through the existing `read()` helper.
6. Keep `CF-xxxx` comments that you copy. Do not invent new numbers.
7. Never log tokens, emails, phone numbers, TIN, RSBSA or payout account numbers
   (`logGuard.test.ts` must stay green).
8. Forms: field errors show under the field (server `422` field errors go to their field,
   see `parseErrorBody` in `apiErrors.ts`); only network/500 errors show at the top.
9. New packages only from plan §3, installed with `npx expo install <pkg>`.
10. Do not edit the shared copies listed in `sharedCopies.test.ts`. If one must change, stop
    and write it under "Open questions".
11. Commit only where the section says so. No `Co-Authored-By` or tool footer lines.

## 1. Facts checked against the repo (2026-11-23)

| Fact | Value |
|---|---|
| Plan 1 state | S1-S12 are done in the working tree but **not committed** (`git status` shows the moves). Plan 2 starts only after Plan 1 S16 is committed (S0 below). |
| `MM/app/` routes | `(tabs)/_layout`, `(tabs)/index`, `orders`, `chats`, `produce`, `more`; `auth`, `not-merchant`, `notifications`, `onboarding`, `order-chat`, `reviews` |
| `MM/src/lib/MerchantContext.tsx` | **already exists**: it is the root gate (`status`, `profile`, `retry`; CF-0120). It does not load data. See §2.1. |
| `MM/src/lib/api.ts` | 384 lines; `send()` always sets `'Content-Type': 'application/json'` (line ~71), so multipart needs a change (S2) |
| `MM/src/lib/notificationLinks.ts` | `payout_released` / `payout_destination_changed` go to `/(tabs)` (comment: "Earnings is Plan 2") |
| `MM/src/lib/inStep.test.ts` | 5 tests: order statuses, status labels, password policy, phone pattern, CF-0133 reply max |
| `MM/src/components/CancelOrderSheet.tsx` | holds `MERCHANT_CANCEL_REASONS` and `MERCHANT_CANCEL_NOTE_MAX = 300` (a component file, so `node --test` cannot import it) |
| `MM/src/screens/OnboardingScreen.tsx` | opens `${WEB_BASE}/merchantOnboarding` in the browser (the Plan 1 hand-off) |
| `MM/src/screens/MoreScreen.tsx` | rows: Reviews, Notifications, Open buyer app, Merchant Centre on the web, Sign out |
| `MM/src/lib/usePolling.ts` | already stops in the background (`AppState`) |
| Installed in `MM/node_modules` | `expo-file-system` (transitive only); **no** `react-native-svg`, `react-native-maps`, `expo-image-picker`, `expo-document-picker`, `expo-sharing`, `expo-clipboard` |
| Web merchant pages | `M/(shell)/`: `page`, `sales`, `chats`, `shipments`, `routing/[shipmentId]`, `earnings`, `reviews`, `produce`, `inventory`, `shop`, `vouchers`, `settings`; `M/onboarding/page.tsx` = 1164 lines |
| Web merchant components | `M/components/`: `CancelOrderForm`, `CashOutPanel` (453), `DangerZone`, `DemandInsight`, `EarningsTab`, `HolidayModePanel`, `OrderCard`, `OrdersTab`, `ProduceFormFields`, `ProduceTab`, `ReviewsTab`, `SetupChecklist`, `ShipmentsTab`, `ShopTab` (399), `StockAlertsPanel`, `StoreDetails` (382), `VerificationBanner`, `VouchersTab`; hooks `useMerchantOrders`, `useMerchantChats`, `useShipmentSelection`; libs `M/lib/format.ts`, `M/lib/verification.ts` |
| Shipment endpoints (backend `routes/shipments.py`) | `POST /merchants/me/shipments`, `GET /merchants/me/shipments`, `GET /shipments/{id}` (tracking), `GET /shipments/{id}/route` (`RouteGeometryResponse`), `POST /merchants/me/orders/{id}/pin-unreachable` (204) |
| `MAX_SHIPMENT_ORDERS` | 20 in `backend/app/schemas/shipment.py:79` and `W/util/api/merchants.ts:645` |
| Web route navigation | `W/util/navigation.ts`: `googleMapsDirectionsUrl`, `wazeNavigationUrl`, `isNavigable` (Google Maps + Waze, no Apple Maps) |
| Payout endpoints | `GET /merchants/me/payout-info`, `POST .../payout-info/code`, `PUT .../payout-info`, `GET /merchants/me/payout-institutions`, `GET /merchants/me/payouts`, `GET .../payouts/available`, `POST .../payouts/request`, `GET /merchants/me/transactions`, `GET /merchants/me/sales?days=`, `GET /merchants/me/sales/export?days=` |
| GCash note on web | `CashOutPanel.tsx:317`: "GCash payouts go through PESONet, so they arrive on banking-day cycles instead of within minutes." |
| Onboarding multipart | `payload` (JSON string), `rsbsa_file`, `gov_id_file`, `bir_cert_file` (`W/util/api/merchants.ts:244-247`) |
| Document rules | `M/onboarding/DocumentDropzone.tsx`: types `application/pdf`, `image/png`, `image/jpeg`, `image/webp`; max 10 MB each |
| Image types on web | produce photo input accepts `image/png,image/jpeg,image/webp` (`ProduceTab.tsx:151`) |
| Body limits | 12 MB default, 42 MB for `/merchant-onboarding/me` (`SYSTEM_REFERENCE.md` 7.4) |
| Rate limits | `shipment_create` 30/h, `onboarding_submit` 10/h (`backend/app/services/rate_limit.py`) |
| Location endpoints | `POST /locations/pin-check`, `/locations/geocode`, `/locations/reverse-geocode` (`W/util/api/locations.ts`); PSGC lists come from `https://psgc.cloud/api/v2` directly (`W/util/psgc.ts:29`) |
| Shop page upload parts | `banner`, `logo` (`W/util/api/merchants.ts:402, 409`) |
| Delete merchant | `POST /merchants/me/delete-code` (optional `password`), `DELETE /merchants/me` with the code |

## 2. Where the plan needed a decision (resolved here)

1. **`MerchantContext.tsx` already exists as the gate.** Plan §4 asks for a data context with
   the same name. Fix: keep the gate file as it is. Add `MM/src/lib/MerchantDataContext.tsx`
   (`MerchantDataProvider`, `useMerchantData`) and mount it inside the gate only when
   `status === 'allowed'` (S3).
2. **No `react-native-svg`.** Plan §5.1 allows plain `View` bars in that case. Use `View` bars.
   Do not add a chart or SVG package.
3. **Tracking and route paths.** Plan §5.4 says "shipment tracking for one shipment" and
   "route geometry". The real paths are `GET /shipments/{id}` and `GET /shipments/{id}/route`
   (§1). Use those.
4. **Navigation apps.** Plan §5.4 says "Google Maps / Apple Maps"; the web (the spec) offers
   Google Maps and Waze. See Decision D1.
5. **Onboarding has three file parts**, not two: `bir_cert_file` is also sent when present.
   Each document: pdf/png/jpeg/webp, 10 MB max, all three under the 42 MB body limit.
6. **`inStep.test.ts` checks are added per section**, in the section that creates the
   constant. Plan phase 1 lists them all in "Foundation", but most constants do not exist
   until later. S3 adds only the checks for constants that already exist.
7. **Cancel reasons live in a component.** S4 moves `MERCHANT_CANCEL_REASONS` and
   `MERCHANT_CANCEL_NOTE_MAX` into pure `src/lib/orderActions.ts` (the component re-imports
   them), so `node --test` can check them against the web.
8. **The address form (plan §2.3) is used by Store settings and Onboarding.** It gets its own
   section (S13) before both.
9. **Payout notification links.** S3 changes `payout_released` / `payout_destination_changed`
   from `/(tabs)` to `/earnings` (plan §4), with test changes. The Earnings route exists from
   S3 as a placeholder.
10. **Reviews (plan §5.6) has no phase in plan §6.** It goes in the "Daily work" phase (S8).
11. **PSGC calls.** The phone calls `psgc.cloud` directly, the same as the web. This is not a
    backend call, so it does not go through `request`; put it in `src/lib/psgc.ts` with its
    own fetch and timeout.
12. **Which order moves the phone offers.** The web `OrderCard` draws only a Cancel button
    (shipping starts in Shipments), but the server allows more (`MERCHANT_TRANSITIONS` in
    `order_status.py`). S4's sheet offers the server's set: `processing → shipped | cancelled`,
    `shipped → out_for_delivery | cancelled`, `out_for_delivery → cancelled`. `delivered` is
    never offered (the buyer or the auto-confirm sweep sets it), and `pending` is not
    cancellable server-side even though the web shows Cancel on it — `canCancel` follows the
    server. To mirror the web card exactly instead, keep only Cancel.
13. **No approximate-pin warning on the order sheet.** The web shows it on the route stop,
    from `pin_approximate` on the shipment. `MerchantOrderResponse` has no such field, so the
    warning waits for the route screen (S11); inventing a guess from the address would lie
    to the farm.
14. **`new_order` opens the Orders tab, not one order.** The backend writes
    `/merchantDashboard` with no `?order=` for that kind (`order_reservations.py`), and the
    web bell opens `/sales`. `notificationLinks.ts` still reads `?order=` when a link carries
    one (a future backend change, or a hand-made `carabaomerchant://orders?order=12`), and the
    tab then scrolls to that order and opens its sheet.

## 3. Decisions to confirm (defaults in brackets)

- **D1 navigation apps** — [default: Google Maps and Waze, the same as the web
  `util/navigation.ts`] vs Google Maps and Apple Maps (plan §5.4 text).
- **D2 route names** — [default: `/shipments`, `/route` (param `shipmentId`), `/earnings`,
  `/inventory`, `/shop`, `/vouchers`, `/settings`, `/application` (onboarding status)]; all
  Stack routes outside `(tabs)`.
- **D3 Android map key** — [default: read `EXPO_PUBLIC_GOOGLE_MAPS_KEY` in `app.config` /
  `app.json` plugin config, document it in the README; without a key the route screen shows
  the stop list and a "Map not available" note on Android].

## 4. Section map (plan item -> section id)

| Plan | Sections |
|---|---|
| §6 phase 1 Foundation (§3 deps, multipart, context, badges, More) | S1, S2, S3 |
| §6 phase 2 Daily work (§5.2, §5.3, §5.7, §5.8, §5.6) | S4, S5, S6, S7, S8 |
| §6 phase 3 Money (§5.5) | S9, S10 |
| §6 phase 4 Delivery (§5.4) | S11, S12 |
| §6 phase 5 Shop setup (§2.3, §5.9, §5.10, §5.11) | S13, S14, S15, S16 |
| §6 phase 6 Onboarding (§5.12) | S17, S18 |
| §6 phase 7 Dashboard (§5.1) | S19 |
| §7 parity checklist, §5.13 account basics | S20 |
| §6 phase 8 Docs | S21 |

## 5. Sections

### S0 - Baseline (no code change)

**Depends on:** Plan 1 S16 done and committed.
**Do**
1. `git status --porcelain`: nothing under `mobile/` is dirty. If Plan 1 work is still
   uncommitted, stop; finish and commit Plan 1 first.
2. In `MM/`: the three checks. Write down the test count.
3. In `mobile/CarabaoMobile`: the three checks. Write down the test count.
4. In `W/`: `npm test`. Write down the result.
5. Write the counts into this section under "Baseline recorded".
**Baseline recorded (2026-11-23, branch `main`, HEAD `6bbfb99`):** Plan 1 is committed
(`d2889d6`, `e0d34d0`, `4b65518`, `835a80b`, `6bbfb99 docs: merchant app split`), so the
dependency holds. `git status --porcelain` shows nothing under `mobile/`; only documentation
changes: `D documentation/manuals/Carabao_System_Manual.pdf`,
`D documentation/manuals/Improvement_Loops_Report_2026-11-20.pdf`, and untracked
`documentation/manuals/MERCHANT_MOBILE_APP_SECTIONS.md` (this file).
Merchant (`MM/`, 24 `*.test.ts` files): `npx tsc --noEmit` exit 0, `npm run lint` exit 0
(no errors/warnings), `npm test` 90 tests / 90 pass / 0 fail (node `duration_ms` 275).
Buyer (`mobile/CarabaoMobile`, 35 `*.test.ts` files): `npx tsc --noEmit` exit 0,
`npm run lint` exit 0 (no errors/warnings), `npm test` 146 tests / 146 pass / 0 fail
(node `duration_ms` 361).
Web (`W/`, 33 `*.test.ts` files): `npm test` 158 tests / 158 pass / 0 fail
(node `duration_ms` 422).
The test runs print the known `MODULE_TYPELESS_PACKAGE_JSON` warnings (no `"type": "module"`
in the three `package.json` files); they are warnings only and all runs exit 0.
Every later merchant count is compared with **90** (equal or higher); the buyer count stays at
**146** and must not change in any section.
**Verify:** all suites pass.
**Done when:** the baseline is written down. Every later merchant count must be equal or
higher; the buyer count must not change in any section.
**Commit:** none.

---

### S1 - Dependencies and app config (plan §3)

**Depends on:** S0. **Decision D3 first.**
**Do**
1. In `MM/`: `npx expo install react-native-maps expo-image-picker expo-document-picker expo-file-system expo-sharing expo-clipboard`.
   `expo-file-system` becomes a direct dependency.
2. `MM/app.json` plugins:
   - `expo-image-picker` with `photosPermission` and `cameraPermission` text in English
     (for example "Carabao Merchant uses your photos for produce and shop pictures.").
   - `react-native-maps` (Android Google Maps key per D3; iOS uses Apple Maps, no key).
   - `expo-document-picker` if SDK 58 needs a plugin entry for it.
3. `MM/README.md`: add `EXPO_PUBLIC_GOOGLE_MAPS_KEY` to the env var list (Android only,
   optional), and a short "Dependencies added in Plan 2" list.
4. Do not import the new packages in any screen yet.
**Verify:** the three checks; `npx expo start` still boots and the gate still works.
**Done when:** the packages are in `package.json` with SDK 58 versions and `app.json` has the
permission text.
**Commit:** none.

---

### S2 - Multipart requests and upload checks (plan §3 "Uploads")

**Depends on:** S1.
**Do**
1. `MM/src/lib/api.ts` `send()`: set `'Content-Type': 'application/json'` only when
   `init.body` is a string. When the body is `FormData`, set no `Content-Type` (fetch adds
   the boundary). Keep auth, timeout and error parsing unchanged.
2. New pure `MM/src/lib/uploads.ts` + `uploads.test.ts`:
   - `IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']` (web `ProduceTab.tsx:151`).
   - `DOCUMENT_TYPES` and `DOCUMENT_MAX_BYTES = 10 * 1024 * 1024`
     (web `M/onboarding/DocumentDropzone.tsx:6-7`), with the same error text
     (`` `${label} must be 10MB or smaller.` `` and the type message the web uses).
   - `BODY_LIMIT_BYTES = 12 * 1024 * 1024`, `ONBOARDING_BODY_LIMIT_BYTES = 42 * 1024 * 1024`.
   - `checkImage({ size, mimeType })` and `checkDocument(label, { size, mimeType })` that
     return an error string or `null`.
   - `filePart(uri, name, type)` that returns `{ uri, name, type }` (the React Native
     `FormData` file shape) and a fallback name/type when the picker gives none.
3. `inStep.test.ts`: `DOCUMENT_TYPES` and `DOCUMENT_MAX_BYTES` = `DocumentDropzone.tsx`;
   body limits = `SYSTEM_REFERENCE.md` 7.4 text (or the backend middleware constant if it
   exists; find it with `Select-String -Path backend\app\**\*.py -Pattern "42"`).
**Verify:** the three checks.
**Done when:** a `FormData` body is sent without a JSON content type, and the upload checks
are tested.
**Commit:** none.

---

### S3 - Merchant data context, badges, final More menu (plan §4, §6 phase 1)

**Depends on:** S2. **Decision D2 first.**
**Do**
1. Read `M/MerchantContext.tsx` and `M/MerchantShell.tsx` (badges).
2. New `MM/src/lib/MerchantDataContext.tsx` (§2.1): loads performance
   (`/merchants/me/performance`), produce (`myProduce`), shop page (`/merchants/me/shoppage`,
   add `api.merchants.shopPage`) and orders once; exposes them, `loading`, `error`, and
   `refreshPerformance/refreshProduce/refreshShopPage/refreshOrders`. Poll orders and chats
   with `usePolling` (same intervals as `src/lib/polling.ts`).
   Mount it in `MM/app/_layout.tsx` inside the gate, only when `status === 'allowed'`.
3. New pure `MM/src/lib/badges.ts` + test: `activeOrderCount(orders)`,
   `readyToShipCount(orders)`, `unreadChatCount(chats)`, `productCount(produce)`, with the
   same status sets as `MerchantShell.tsx`. Use it in `(tabs)/_layout.tsx`: Orders = active
   orders, Chats = unread (alert colour), Produce = product count.
4. Placeholder routes per D2: `MM/app/shipments.tsx`, `route.tsx`, `earnings.tsx`,
   `inventory.tsx`, `shop.tsx`, `vouchers.tsx`, `settings.tsx`, `application.tsx`
   (each a small "Coming in a later section" screen, removed by the owning section).
5. `MoreScreen.tsx` rows in plan §4 order: Shipments (badge = ready-to-ship, alert colour),
   Earnings, Reviews, Inventory, Shop page, Vouchers, Store settings, Notifications, Open
   buyer app, Merchant Centre on the web, Sign out.
6. `notificationLinks.ts` + test: `payout_released`, `payout_destination_changed` ->
   `{ pathname: '/earnings' }`; add `'/earnings'` to `AppRoute`; update the comment.
7. `inStep.test.ts`: order status sets used by `badges.ts` = the web `MerchantShell.tsx`
   sets (read the file as text and compare the status names).
**Verify:** the three checks; manual: badges show the right numbers, every More row opens a
screen, a payout notification opens `/earnings`, the gate still blocks a buyer account and
no `/merchants/me/*` call is made before `allowed`.
**Done when:** tabs share one data load and the badges match the web.
**Commit:** `feat(mobile-merchant): data context, badges, More menu, deps and multipart`

---

### S4 - Orders (plan §5.2)

**Depends on:** S3.
**Do**
1. Read `M/(shell)/sales/page.tsx`, `M/components/OrdersTab.tsx`, `OrderCard.tsx`,
   `CancelOrderForm.tsx`, `M/hooks/useMerchantOrders.ts`.
2. Move `MERCHANT_CANCEL_REASONS` / `MERCHANT_CANCEL_NOTE_MAX` to new pure
   `MM/src/lib/orderActions.ts` (§2.7); `CancelOrderSheet.tsx` imports them from there.
   Add `nextStatuses(status)` (the status changes the web allows from each status, and no
   other) and `orderFilter(orders, chip)`. Test both.
3. `inStep.test.ts`: cancel reasons and note max = web `W/util/api/merchants.ts`; the allowed
   transitions = the web source of `nextStatuses` (find where `OrderCard.tsx` decides the
   buttons).
4. `MerchantOrdersScreen.tsx`: status filter chips; order detail sheet (items, buyer,
   address); "Open chat" -> `/order-chat`. No approximate-pin warning: an order does not
   carry `pin_approximate`, so it belongs to the route screen (S11, §2.13).
5. Deep link `carabaomerchant://orders?order=<id>`: the Orders tab reads the `order` param,
   scrolls to that order and opens its sheet. Make the notification link for `new_order`
   with an order id use it if the web link carries the id: the backend writes
   `/merchantDashboard` with no id, so `new_order` opens the tab (§2.14).
6. Use the data context orders and call `refreshOrders()` after a change.
**Verify:** the three checks; manual: every status change the web allows works, others are
not offered; cancel with reason and note; the deep link opens the order.
**Done when:** Orders matches the web sales page.
**Status:** done (2026-11-23): `tsc --noEmit`, `expo lint` and `npm test` (109 tests) are
green; the moves offered are the server's (§2.12). Not committed yet, as below.
**Commit:** none.

---

### S5 - Chats and inquiries (plan §5.3)

**Depends on:** S4.
**Do**
1. Read `M/(shell)/chats/page.tsx`, `M/hooks/useMerchantChats.ts`,
   `W/components/OrderChat/OrderChat.tsx`, `W/util/api/merchants.ts`
   (`fetchMyMerchantInquiries`, `inquiryEndpoint`, `InquirySummary`).
2. `api.ts`: `api.merchants.inquiries` (`GET /merchants/me/inquiries`) with
   `ApiInquirySummary`; `api.inquiry.thread/send` (`GET/POST /inquiries/{conversation_id}/messages`).
3. `MerchantChatsScreen.tsx`: two segments "Orders" and "Questions". Questions lists the
   pre-order inquiries with unread state.
4. `OrderChatScreen.tsx`: accept an `inquiry=<conversation_id>` param; when present, use the
   inquiry endpoints. Closed chats are read-only (same rule as the web). Keep the order and
   support branches. Put the endpoint choice in a pure helper (in `orderChat.ts`) with tests.
5. Unread badge: after the screen reads a thread, refresh chats so the badge clears.
**Verify:** the three checks; manual: answer a buyer's pre-order question, the badge clears,
a closed chat has no input.
**Done when:** both segments work against the web endpoints.
**Status:** done (2026-11-23): `tsc --noEmit`, `expo lint` and `npm test` (115 tests) are
green. `orderChat.chatTarget/chatEndpoint` pick the thread and its URL; `chatInbox` sorts
and previews both lists; `MerchantDataContext` loads chats + inquiries together (the badge
uses `unreadChatCount(chats, inquiries)`); `?inquiry=<id>` deep links open the question and
a closed question has no input. Not committed yet, as below.
**Commit:** none.

---

### S6 - Produce photos and field errors (plan §5.7)

**Depends on:** S2, S3.
**Do**
1. Read `M/(shell)/produce/page.tsx`, `M/components/ProduceTab.tsx`,
   `ProduceFormFields.tsx`, `W/util/api/produce.ts` (`uploadProduceImage`, form field name),
   `W/lib/input-limits.ts`.
2. `api.ts`: `api.produce.uploadImage(token, id, file)` -> `POST /produce/{id}/image`
   (multipart, same field name as the web).
3. `ListingForm.tsx` / `ProduceScreen.tsx`: "Choose photo" and "Take photo" with
   `expo-image-picker`; check with `checkImage` (S2) before upload; upload after create and
   on edit; show a placeholder until the upload is done; show upload errors under the photo.
4. Field errors under each field (rule 8): map server `422` fields to the form fields.
   Put the field-name mapping in `listingForm.ts` with tests.
5. `inStep.test.ts`: any produce limit in `W/lib/input-limits.ts` that the form uses and that
   is not checked yet.
**Verify:** the three checks; manual: a new listing with a photo shows on the buyer farm
page; a bad price shows the error under the price field.
**Done when:** photos upload from camera and library, with the web limits.
**Status:** done (2026-11-23): `tsc --noEmit`, `expo lint` and `npm test` (120 tests) are
green. `api.produce.uploadImage` sends the web's multipart part (`image`); `ListingForm`
offers "Choose photo" and "Take photo" with `expo-image-picker` and refuses what the web
input would (`checkImage`, S2, with `imageMimeType` for a picker that leaves the type out);
`ProduceScreen` uploads after create and on edit, shows the row's placeholder until the
upload lands, and keeps the form open with the reason under the photo if it fails.
`listingSaveErrors` maps the backend field names to the form's controls (rule 8), and
`checkListing` names its own field so a locally caught bad price shows under the price box
too. Not committed yet, as below.
**Commit:** none.

---

### S7 - Inventory (plan §5.8)

**Depends on:** S6.
**Do**
1. Read `M/(shell)/inventory/page.tsx`, `M/components/StockAlertsPanel.tsx`,
   `M/components/DemandInsight.tsx`.
2. `api.ts`: `api.merchants.setLowStockThreshold` (`PATCH /merchants/me/stock-alerts`,
   body `{ low_stock_threshold }`).
3. New `MM/src/screens/InventoryScreen.tsx`, route `/inventory` (replace the placeholder):
   stock list with quick +/− and edit (`PATCH /produce/{id}`); low-stock / expiring / expired
   groups; threshold setting with the web's min/max; demand insight (most ordered, most
   searched in province and Luzon, unmet searches) using the `dashboard.ts` helpers.
4. Pure helpers (grouping, threshold check, stock step) in a new `src/lib/inventory.ts`
   + test. `inStep.test.ts`: threshold limits = web/backend.
**Verify:** the three checks; manual: change stock with +/−, change the threshold, the groups
update.
**Done when:** Inventory matches the web inventory page.
**Commit:** none.

---

### S8 - Reviews parity (plan §5.6)

**Depends on:** S3.
**Do**
1. Compare `MM/src/screens/MerchantReviewsScreen.tsx` with `M/components/ReviewsTab.tsx`
   and `W/lib/review-reply.ts`.
2. Add any filter, sort or text the web has and the app does not. Keep `myReviews.ts` as the
   only source of reply rules; add tests for new helpers.
3. If nothing is missing, write "no gap found" in this section and change no code.
**Verify:** the three checks.
**Done when:** every filter and sort on the web exists on the phone.
**Status:** done (2026-11-23): `tsc --noEmit`, `expo lint` and `npm test` (130 tests) are
green. Gaps found and fixed: the web's "All" and "1–2★" chips (the phone had only the star
chips and "With comment"), its "Customer Reviews" heading, its two empty states ("No reviews
yet. Buyers can rate an order once it’s delivered." / "No reviews match this filter."), "No
comment left." on a review without text, the summary's "with comments" wording, and the
"View order #N →" link (which opens that order on the Orders tab, S4). `myReviews.ts` gains
`CRITICAL_RATINGS`, `isAllReviews` and `isCriticalFilter`, with tests. Neither side sorts:
`GET /merchants/me/reviews` is newest first, so there is no sort to copy. The reply rules
already matched `W/lib/review-reply.ts` and stay in `myReviews.ts`.
**Commit:** `feat(mobile-merchant): orders, chats + inquiries, produce photos, inventory, reviews`

---

### S9 - Payout destination (plan §5.5, part 1)

**Depends on:** S8.
**Do**
1. Read `M/(shell)/earnings/page.tsx`, `M/components/EarningsTab.tsx`,
   `M/components/CashOutPanel.tsx` (destination part), `SYSTEM_REFERENCE.md` 7.7.
2. `api.ts`: `payoutInfo`, `payoutInstitutions` (`GET /merchants/me/payout-institutions`),
   `sendPayoutCode` (`POST /merchants/me/payout-info/code`), `updatePayoutInfo`
   (`PUT /merchants/me/payout-info`, payload + `code`). Types `PayoutInfo`,
   `PayoutInfoPayload`, `PayoutInstitution` copied from `W/util/api/merchants.ts`.
3. New pure `MM/src/lib/payout.ts` + test: payout type labels (`bank`, `gcash`, `maya` as the
   web), destination validation (same rules and text as `CashOutPanel.tsx`), account number
   mask (same as the web display), "code is for this exact destination" check (a code sent
   for one destination is not used for an edited one).
4. New `MM/src/screens/EarningsScreen.tsx`, route `/earnings` (replace the placeholder):
   current destination (masked); edit form (type, institution picker, account name and
   number); "Send code" -> enter code -> Save. The GCash PESONet note (§1) shows only when the
   type is GCash, with the web text.
5. Never log account numbers (rule 7).
**Verify:** the three checks; manual: change the destination with an SMS code; editing the
destination after "Send code" asks for a new code.
**Done when:** the destination flow matches the web.
**Commit:** none.

---

### S10 - Cash out, history, sales, CSV export (plan §5.5, part 2)

**Depends on:** S9.
**Do**
1. Read the rest of `CashOutPanel.tsx` and `EarningsTab.tsx`; `W/util/api/merchants.ts`
   `downloadMySalesCsv`, `fetchMySales`.
2. `api.ts`: `availablePayout`, `requestPayout`, `payouts`, `transactions`,
   `sales(days: 30 | 90)`. For export, a function that returns the CSV text from
   `GET /merchants/me/sales/export?days=7|30|90` (add a text response option to `request`
   without changing the JSON path).
3. `EarningsScreen.tsx`: available balance and transfer fee; "Cash out" with a confirm
   dialog, disabled when nothing is available or there is no destination (same rule as the
   web, as a pure function in `payout.ts` with tests); payout history; transaction list;
   sales summary with a 30/90 switch; "Export CSV" with 7/30/90: write the file with
   `expo-file-system` to the cache folder, then open `expo-sharing`.
4. `inStep.test.ts`: allowed `days` values for sales and export = web types.
**Verify:** the three checks; manual: request a payout; export a CSV and share it.
**Done when:** plan §5.5 "Done" holds.
**Commit:** `feat(mobile-merchant): earnings and payouts`

---

### S11 - Shipments list and create (plan §5.4, part 1)

**Depends on:** S10.
**Do**
1. Read `M/(shell)/shipments/page.tsx`, `M/components/ShipmentsTab.tsx`,
   `M/hooks/useShipmentSelection.ts`.
2. `api.ts`: `createShipment(orderIds)` (`POST /merchants/me/shipments`), `shipments`
   (`GET /merchants/me/shipments`). Types `MerchantShipmentTracking` (with
   `skipped_orders`), `MerchantShipmentSummary` from `W/util/api/merchants.ts`.
3. New pure `MM/src/lib/shipments.ts` + test: `MAX_SHIPMENT_ORDERS = 20`, selection toggle
   with the cap and the web message, skip reason text for `no_location` and `no_road` (the
   web words).
4. `inStep.test.ts`: `MAX_SHIPMENT_ORDERS` = `backend/app/schemas/shipment.py` =
   `W/util/api/merchants.ts`.
5. New `MM/src/screens/ShipmentsScreen.tsx`, route `/shipments`: ready orders with check
   boxes (cap 20); "Make route"; a result sheet that lists skipped orders with reasons; the
   shipment list; each shipment opens `/route?shipmentId=<id>`. A `429` shows the server
   message (`shipment_create` 30/h). Refresh orders after create (ready count badge).
**Verify:** the three checks; manual: select 2+ orders and make a route; the 21st order is
refused with the message.
**Done when:** shipments can be made and listed.
**Commit:** none.

---

### S12 - Route screen and map (plan §5.4, part 2)

**Depends on:** S11, S1 (`react-native-maps`). **Decision D1 first.**
**Do**
1. Read `M/(shell)/routing/[shipmentId]/page.tsx`, `W/components/RouteMap/RouteMap.tsx`,
   `W/util/tracking.ts`, `W/util/navigation.ts`.
2. `api.ts`: `shipmentTracking(id)` (`GET /shipments/{id}`), `shipmentRoute(id)`
   (`GET /shipments/{id}/route`, `RouteGeometryResponse`), `reportUnreachablePin(orderId)`
   (`POST /merchants/me/orders/{id}/pin-unreachable`, 204).
3. New pure `MM/src/lib/routeMap.ts` + test: GeoJSON `[lng, lat]` -> `{ latitude, longitude }`;
   map region that fits all points; stop order numbers.
   New pure `MM/src/lib/navigation.ts` + test: a copy of `W/util/navigation.ts`
   (`googleMapsDirectionsUrl`, `wazeNavigationUrl` per D1, `isNavigable`) and the status
   helpers the page uses from `W/util/tracking.ts` (`isClosedStatus`, `isRouteFinished`,
   `statusLabel`). Copy their tests if the web has them.
4. New `MM/src/screens/RouteScreen.tsx`, route `/route`: `MapView` with a pickup marker,
   numbered stop markers and a `Polyline`; stop list with planned arrival; per stop "Open in
   Google Maps" and the D1 second app (`Linking.openURL`); "Pin unreachable" with a confirm
   dialog. Poll the tracking while the route is not finished (same as web `useVisiblePoll`).
   The phone never calls Mapbox. On Android without a key (D3), show the list and a note.
**Verify:** the three checks; manual: open a route for 2+ orders, see it on the map, open
navigation to a stop, report an unreachable pin.
**Done when:** plan §5.4 "Done" holds.
**Commit:** `feat(mobile-merchant): shipments and route map`

---

### S13 - Address form building block (plan §2.2, §2.3)

**Depends on:** S12 (`react-native-maps` in use).
**Do**
1. Read `W/components/LocationSelects`, `W/components/MapPinPicker`, `W/util/psgc.ts`,
   `W/util/geocode.ts`, `W/util/pinLocation.ts`, `W/lib/pin-area.ts`,
   `W/util/api/locations.ts`.
2. New pure libs + tests:
   - `MM/src/lib/psgc.ts`: the same PSGC source and shapes as `W/util/psgc.ts` (§2.11);
     NCR province shows and saves as "Metro Manila" (plan §2.2).
   - `MM/src/lib/pinLocation.ts`: copy of the web pin rules (`pinLocation.ts`,
     `pin-area.ts`), no DOM code.
3. `api.ts`: `geocode`, `reverseGeocode`, `pinCheck` (`POST /locations/...`).
4. New component `MM/src/components/AddressForm.tsx`: region -> province -> city -> barangay
   selects, postal code, street, then the map pin. The pin is placed from the address
   (geocode); the user may drag it; moving the pin never changes the text fields. Output:
   address fields + `latitude`, `longitude`, `pin_confirmed`. Field errors under each field.
5. `inStep.test.ts`: the PSGC base URL and the NCR label = `W/util/psgc.ts`.
6. Not used by any screen yet; S16 and S18 use it.
**Verify:** the three checks (tests cover the NCR rule and the pin rules).
**Done when:** the component and its libs exist and are tested.
**Commit:** none.

---

### S14 - Shop page (plan §5.9)

**Depends on:** S2, S3.
**Do**
1. Read `M/(shell)/shop/page.tsx`, `M/components/ShopTab.tsx`, `W/lib/shop-slug.ts`,
   `W/lib/farm-images.ts`, `SYSTEM_REFERENCE.md` 7.4 shop page rules.
2. `api.ts`: `shopPage` (from S3), `createShopPage`, `updateShopPage`, `publishShopPage`,
   `unpublishShopPage`, `discardShopPageDraft`, `uploadShopLogo` (part `logo`),
   `uploadShopBanner` (part `banner`). Type `MyShopPage` from the web.
3. New pure `MM/src/lib/shopSlug.ts` (copy of `W/lib/shop-slug.ts`) and
   `MM/src/lib/shopPage.ts` (state: not published / live / live with unpublished changes;
   when Discard shows) + tests. `inStep.test.ts`: slug rules and title/description limits =
   web/backend.
4. New `MM/src/screens/ShopScreen.tsx`, route `/shop`: draft editor (title, slug with a live
   format check, description); logo and banner pickers (`checkImage`, each upload changes the
   draft only); state chip; Publish; Discard changes (only if published before); Unpublish
   with the confirm text "the farm is hidden from buyers; open orders continue"; "Preview"
   opens the public farm page on the web. Call `refreshShopPage()` after each change.
**Verify:** the three checks; manual: first publish makes the farm show in the buyer app's
farm list; discard resets the draft.
**Done when:** plan §5.9 "Done" holds.
**Commit:** none.

---

### S15 - Vouchers (plan §5.10)

**Depends on:** S3.
**Do**
1. Read `M/(shell)/vouchers/page.tsx`, `M/components/VouchersTab.tsx`, `W/lib/vouchers.ts`,
   `W/util/api/vouchers.ts`.
2. `api.ts`: `vouchers`, `createVoucher`, `updateVoucher`, `deleteVoucher`
   (`/merchants/me/vouchers[/{id}]`). Types `Voucher`, `VoucherInput`, `VoucherChanges`.
3. New pure `MM/src/lib/vouchers.ts` + test: the same rules and messages as
   `W/lib/vouchers.ts` (code format, amounts, dates, "can delete only when unused").
   `inStep.test.ts`: voucher code rules and limits = `W/lib/vouchers.ts`.
4. New `MM/src/screens/VouchersScreen.tsx`, route `/vouchers`: list, create form (field
   errors under fields), on/off switch, delete only for unused vouchers, copy code with
   `expo-clipboard`.
**Verify:** the three checks; manual: create, switch off, copy, delete an unused voucher; a
used voucher has no delete.
**Done when:** Vouchers matches the web.
**Commit:** none.

---

### S16 - Store settings (plan §5.11)

**Depends on:** S13, S3.
**Do**
1. Read `M/(shell)/settings/page.tsx`, `M/components/StoreDetails.tsx`,
   `HolidayModePanel.tsx`, `DangerZone.tsx`, `W/lib/store-pause.ts`, `W/lib/phone.ts`.
2. `api.ts`: `myMerchant` (`GET /merchants/me`), `updateMyMerchant` (`PATCH`),
   `pauseStore(pausedUntil, message)` (`PUT /merchants/me/pause`), `resumeStore`
   (`DELETE /merchants/me/pause`), `sendDeleteCode(password?)`, `deleteMerchant(code)`.
3. New pure `MM/src/lib/storePause.ts` (copy of `W/lib/store-pause.ts`) + test;
   `inStep.test.ts`: pause rules (max days, message max) = web.
4. New `MM/src/screens/SettingsScreen.tsx`, route `/settings`:
   - Store details: pickup address with `AddressForm` (S13), delivery days and price,
     contact number (`phone.ts`). Saves `pin_confirmed` with the address.
   - Holiday mode: pause until a date with a message; resume.
   - Danger zone: send code (password if the web asks for it), enter code, delete the
     merchant profile; after delete, sign-out is not needed: re-run the gate
     (`retry`) so the user lands on `/not-merchant`.
**Verify:** the three checks; manual: the address saves with `pin_confirmed`; NCR shows
"Metro Manila"; pausing hides the shop in the buyer app; resume shows it again.
**Done when:** plan §5.11 "Done" holds.
**Commit:** `feat(mobile-merchant): address form, shop page, vouchers, store settings`

---

### S17 - Native onboarding, part 1: libs and the operations step (plan §5.12)

**Depends on:** S13, S2.
**Do**
1. Read `M/onboarding/page.tsx` (all 1164 lines), `ContactCodeField.tsx`,
   `W/util/serviceArea.ts`, `W/hooks/useResendCooldown.ts`, `W/util/api/merchants.ts`
   (`submitMyMerchantOnboarding`, `fetchMyMerchantApplication`, `MerchantApplication`).
2. New pure libs + tests:
   - `MM/src/lib/onboarding.ts`: `STEPS` (ids, titles, subtitles as the web), seller types,
     the form state shape, per-step validation with the web messages, `stepOfField(field)`,
     "first step with a problem" from server field errors, the "Submit later" payload
     (step 1 and seller type only).
   - `MM/src/lib/resendCooldown.ts`: the cooldown logic of `useResendCooldown` as pure
     functions (a hook in the screen uses it).
   - `MM/src/lib/serviceArea.ts`: copy of `W/util/serviceArea.ts`.
   `inStep.test.ts`: step ids, seller types, cooldown seconds, field limits = web.
3. `api.ts`: `myApplication` (`GET /merchant-applications/me`), OTP calls
   `POST /sms/otp/send|verify` (purpose `merchant_phone`) and `/email/otp/send|verify`
   (purpose `merchant_email`) - signed-in, no captcha.
4. New `MM/src/screens/OnboardingFormScreen.tsx` with step 1 (operations) only: progress
   "1 / 2", seller type, the fields of the web operations step, pickup address with
   `AddressForm`, contact code fields (`ContactCodeField` behaviour) with resend cooldown.
   "Next" validates step 1. Not linked from the app yet.
**Verify:** the three checks.
**Done when:** step 1 works in isolation and all onboarding rules are tested.
**Commit:** none.

---

### S18 - Native onboarding, part 2: documents, submit, status (plan §5.12)

**Depends on:** S17.
**Do**
1. Read `M/onboarding/DocumentDropzone.tsx` and the legal step and submit code in
   `M/onboarding/page.tsx`.
2. `api.ts`: `submitOnboarding(payload, files)` -> `POST /merchant-onboarding/me`
   (multipart: `payload` JSON string, `rsbsa_file`, `gov_id_file`, `bir_cert_file` when
   present). Check total size against `ONBOARDING_BODY_LIMIT_BYTES` before send.
3. `OnboardingFormScreen.tsx` step 2 (legal and documents): the web fields; document pick
   with `expo-document-picker`, checked with `checkDocument` (S2) before upload; "Submit
   later" sends step 1 + seller type only; "Submit" sends all. Server errors: go to the first
   step with a problem and show each under its field. `429` (`onboarding_submit` 10/h) shows
   the server message. `PHONE_VERIFICATION_REQUIRED` opens `PhoneVerifySheet`, then returns
   to the form.
4. New `MM/src/screens/ApplicationScreen.tsx`, route `/application` (replace the
   placeholder): status submitted / needs changes (with the admin's notes and an "Edit"
   button) / approved (button that re-runs the gate with `retry`).
5. `MM/app/onboarding.tsx` now shows the native flow: application status first if one
   exists, else the form. `?step=business` opens the legal step (as the web).
   Keep a small "Continue on the web" link (the old hand-off) as a fallback.
6. `/onboarding` and `/application` must be reachable for a signed-in user who is
   `forbidden` (not a merchant yet): check the gate in `MM/app/_layout.tsx` lets them through.
**Verify:** the three checks; manual: a new account applies fully on the phone; the admin
sees the application with both documents; "Submit later" saves step 1 only.
**Done when:** plan §5.12 "Done" holds.
**Commit:** `feat(mobile-merchant): native onboarding`

---

### S19 - Dashboard polish (plan §5.1)

**Depends on:** S18 (every checklist target screen exists).
**Do**
1. Read `M/(shell)/page.tsx`, `M/components/SetupChecklist.tsx`,
   `M/components/VerificationBanner.tsx`, `M/MerchantWelcome.tsx`, `M/lib/verification.ts`,
   `M/lib/format.ts`.
2. New pure `MM/src/lib/setupChecklist.ts` + test: the same items, order, done rules and
   labels as `SetupChecklist.tsx`; each item has the mobile route that fixes it
   (`/shop`, `/(tabs)/produce`, `/earnings`, `/settings`, `/application`).
   Add the `verification.ts` and `format.ts` rules to `dashboard.ts` or `format.ts` with tests.
3. `MerchantDashboardScreen.tsx`: setup checklist for a new merchant; "needs your
   attention" list (as the web); revenue and order bars for the last 30 days with plain
   `View` bars (§2.2); recent orders; welcome text as `MerchantWelcome.tsx`. Use the data
   context; no second load of the same data.
**Verify:** the three checks; manual: a new merchant sees the checklist and each item opens
the right screen; a verified live merchant sees stats and bars.
**Done when:** plan §5.1 "Done" holds.
**Commit:** `feat(mobile-merchant): dashboard checklist and charts`

---

### S20 - Acceptance and parity pass (plan §7, §5.13)

**Depends on:** S1-S19.
**Do** (no new features; fix what the pass finds)
1. Fill the plan §7 table: one row per web page, "yes" only after a manual check on a
   device or simulator.
2. `Select-String -Path app\**\*.tsx -Pattern "Coming in a later section"` in `MM/` -> no
   results (no placeholders left).
3. `Select-String -Path src\**\*.ts,src\**\*.tsx -Pattern "console\.(log|info|debug)"` ->
   no new logging of user data (rule 7); `logGuard.test.ts` green.
4. Plan §5.13: idle logout returns to `/auth`; sign out; "Open buyer app"; "Merchant Centre
   on the web". The app deletes only the merchant profile, never the account.
5. Test counts: merchant ≥ S0 count + new tests; buyer = S0 count; web `npm test` green.
**Verify:** the table is all "yes", the greps are clean, all suites pass.
**Done when:** a farm can run its shop without the web.
**Commit:** none.

---

### S21 - Docs (plan §6 phase 8)

**Depends on:** S20.
**Do**
1. `MM/README.md`: how to run, all env vars (with `EXPO_PUBLIC_GOOGLE_MAPS_KEY`), map key
   notes, new dependencies, "Known gaps" and "Open questions".
2. `documentation/manuals/SYSTEM_REFERENCE.md` §1 (components) and §4.3 (merchant app env
   vars and features).
3. `documentation/manuals/SUBDOMAINS.md` 1.5: the mobile merchant app reads
   `/merchantDashboard` notification links by kind.
4. `MERCHANT_MOBILE_APP_PLAN.md`: a "Status" line per phase that names the sections and
   commits; correct the plan text where §2 of this file disagreed (data context file name,
   shipment paths, Waze/Apple Maps per D1, `bir_cert_file`).
5. This file: tick S1-S21 with commit hashes
   (`git log --oneline -- mobile/CarabaoMerchantMobile`).
**Verify:** markdown links resolve; every command in the docs runs as written.
**Done when:** a new contributor can run and test the merchant app from the docs alone.
**Commit:** `docs: merchant centre on mobile`

---

## 6. Traceability

| Plan item | Section |
| --- | --- |
| §1 rules | §0 (every section) |
| §2.1 inline field errors | §0 rule 8; S6, S9, S13-S18 |
| §2.2 NCR = Metro Manila | S13, S16 |
| §2.3 address pin flow | S13, S16, S17 |
| §2.4 sign-in on `/auth` | S20 |
| §3 dependencies + app.json | S1 |
| §3 uploads (multipart, size/type checks) | S2 |
| §4 tabs, More menu, badges | S3 |
| §4 `MerchantContext` (data) | S3 (as `MerchantDataContext.tsx`) |
| §4 notification kinds -> Earnings | S3 |
| §5.1 Dashboard | S19 |
| §5.2 Orders | S4 |
| §5.3 Chats + inquiries | S5 |
| §5.4 Shipments and routes | S11, S12 |
| §5.5 Earnings and payouts | S9, S10 |
| §5.6 Reviews | S8 |
| §5.7 Produce photos | S6 |
| §5.8 Inventory | S7 |
| §5.9 Shop page | S14 |
| §5.10 Vouchers | S15 |
| §5.11 Store settings | S16 |
| §5.12 Onboarding | S17, S18 |
| §5.13 Account basics | S20 |
| §6 phases 1-8 | S1-S21 (see §4) |
| §7 parity checklist | S20 |
| §8 out of scope | §0 rules 1, 10 |
