# Plan 2: CarabaoMerchantMobile, full Merchant Centre on mobile

Status: draft plan, 2026-11-22. Start after Plan 1 (`MOBILE_MERCHANT_SPLIT_PLAN.md`) is done: the merchant app exists, signs in, gates on the merchant role, and has Dashboard, Orders, Chats, Produce, Reviews, Notifications, More.

## 0. Goal

The merchant app does everything the web Merchant Centre (`merchant.` host, `frontend/carabao-app/app/(site)/(merchant)/merchant/`) does, using the same backend endpoints. The backend does not change. When this plan is done, a farm never needs the web to run its shop.

The web code is the **spec**. For each feature, read the web files listed, copy the rules (validation, limits, labels, error handling), and rebuild the UI with React Native. Do not invent behaviour the web does not have.

## 1. Rules for the agent doing this work

1. No backend changes. If an endpoint seems missing, stop and write it down in `mobile/CarabaoMerchantMobile/README.md` under "Open questions" instead of adding one.
2. Same conventions as Plan 1: pure logic in `src/lib/*.ts` + `*.test.ts` (`node --test`, `.ts` imports, no `react-native` import); screens in `src/screens`; `app/` route files are 1-line re-exports; keep `CF-xxxx` comments copied from web code, do not invent new numbers.
3. Any value that must match the web or backend (max lengths, enums, limits, labels) gets a check in `src/lib/inStep.test.ts` that reads the web/backend source file, like the buyer app does. Examples: `MAX_SHIPMENT_ORDERS = 20` (`backend/app/schemas/shipment.py`, `frontend/carabao-app/util/api/merchants.ts`), merchant cancel reasons and note max, voucher code rules (`frontend/carabao-app/lib/vouchers.ts`), shop slug rules (`lib/shop-slug.ts`), store pause rules (`lib/store-pause.ts`), review reply max, input limits.
4. After each phase: `npx tsc --noEmit`, `npm run lint`, `npm test` in the merchant app. All pass before moving on. Commit per phase.
5. Never log tokens, emails, phone numbers, TIN, RSBSA or payout account numbers (`logGuard.test.ts`).
6. Every new endpoint call goes in `src/lib/api.ts` with a typed response copied from the web type (`frontend/carabao-app/util/api/*.ts`) or the backend schema (`backend/app/schemas/*.py`).
7. New dependencies: only the ones listed in section 3, installed with `npx expo install <pkg>` so versions match SDK 58.

## 2. Site standards that apply to this app

These are fixed product rules. Follow them in every form.

1. **Inline field errors.** A failed field is highlighted and its message is shown directly under it. No bottom-only error banner. Server `422` field errors map to their field (see web `@/util/errorHelper` and `FieldError`). A general error (network, 500) may show at the top of the form.
2. **NCR province = Metro Manila.** When the region is NCR, the province shows and saves as "Metro Manila", never "Not applicable".
3. **Address form pin flow.** Order: region/province/city/barangay selects → postal code → street → map pin. The pin is placed from the address (geocode), the user may drag it, and moving the pin never rewrites the text fields. Save `pin_confirmed` with the address. Web reference: `components/LocationSelects`, `components/MapPinPicker`, `util/psgc.ts`, `util/geocode.ts`, `util/pinLocation.ts`, `lib/pin-area.ts`.
4. **Sign-in.** The app signs in on its own `/auth` screen. Logout and idle logout return to that screen.

## 3. New dependencies (install with `npx expo install`)

| Package | For |
|---|---|
| `react-native-maps` | route map (Shipments), pickup pin (Settings, Onboarding). Draw the GeoJSON route the API returns; the phone never calls Mapbox. |
| `expo-image-picker` | produce photo, shop logo, shop banner |
| `expo-document-picker` | onboarding documents (RSBSA, government ID, BIR cert) |
| `expo-file-system`, `expo-sharing` | sales CSV export |
| `expo-clipboard` | copy voucher code, shop link |

Add the config plugins they need to `app.json` (camera/photo permission text in English). If `react-native-maps` needs a Google Maps key on Android, read it from `EXPO_PUBLIC_GOOGLE_MAPS_KEY` and document it in the README; on iOS use Apple Maps (no key).

Uploads: send `multipart/form-data` with `{ uri, name, type }` file parts through `request` (do not set `Content-Type` yourself; let fetch add the boundary). Check file size and type on the phone before upload, using the same limits the web/backend use (body limit 12 MB normally, 42 MB for onboarding, `SYSTEM_REFERENCE.md` 7.4).

## 4. Navigation (final)

Tabs: **Home**, **Orders**, **Chats**, **Produce**, **More**.

More → Shipments, Earnings, Reviews, Inventory, Shop page, Vouchers, Store settings, Notifications, Open buyer app, Merchant Centre on the web, Sign out.

Badges (same as web `MerchantShell.tsx`): Orders = active order count, Chats = unread count (alert colour), Shipments row = ready-to-ship count (alert colour), Produce = product count.

Add `src/lib/MerchantContext.tsx` like the web `MerchantContext.tsx`: loads performance, produce, shop page and orders once, exposes them plus `refresh*()` functions, so tabs share data and badges. Poll with the existing `usePolling` (only while the app is foregrounded).

Notification kinds → screens (update `notificationLinks.ts` from Plan 1): `payout_released`, `payout_destination_changed` → Earnings. The rest as in Plan 1.

## 5. Features

Each feature lists: web files to read (paths under `frontend/carabao-app/`), endpoints, what to build, and done checks. `M/` = `app/(site)/(merchant)/merchant/`.

### 5.1 Dashboard (extend Plan 1's screen)
- Web: `M/(shell)/page.tsx`, `M/components/SetupChecklist.tsx`, `M/components/VerificationBanner.tsx`, `M/MerchantWelcome.tsx`, `M/lib/verification*`, `M/lib/format*`.
- Endpoints: `GET /merchants/me/performance`, `/merchants/me/stock-alerts`, `/merchants/me/demand`, `/merchants/me/shoppage`, `/merchant-applications/me`, `/merchants/me/orders`.
- Build: setup checklist (each item links to the screen that fixes it), "needs your attention" list, revenue and order charts for the last 30 days (simple bar chart with `react-native-svg` if already a transitive dep, otherwise plain `View` bars; no chart library), recent orders.
- Done: a new merchant sees the checklist; a verified live merchant sees stats and charts; each checklist item opens the right screen.

### 5.2 Orders (extend)
- Web: `M/(shell)/sales/page.tsx`, `M/components/OrdersTab.tsx`, `M/components/OrderCard.tsx`, `M/components/CancelOrderForm.tsx`, `M/hooks/useMerchantOrders*`.
- Endpoints: `GET /merchants/me/orders`, `PATCH /merchants/me/orders/{id}/status`, cancel (same endpoint as web `cancelMerchantOrder`).
- Build: filter chips by status, order detail sheet (items, buyer, address, pin approximate warning), open chat, deep link `carabaomerchant://orders?order=<id>` scrolls to and opens that order.
- Done: every status change the web allows is possible, and no other.

### 5.3 Chats + inquiries
- Web: `M/(shell)/chats/page.tsx`, `components/OrderChat/OrderChat.tsx`, `util/api/merchants.ts` (`fetchMyMerchantInquiries`, `inquiryEndpoint`).
- Endpoints: `GET /merchants/me/chats`, `GET /merchants/me/inquiries`, `GET/POST /orders/{id}/messages`, `GET/POST /inquiries/{conversation_id}/messages`.
- Build: two segments "Orders" and "Questions" (pre-order inquiries). Reuse `OrderChatScreen` for both by passing the endpoint. Closed chats are read-only.
- Done: merchant can answer a buyer's pre-order question; unread badge clears after reading.

### 5.4 Shipments and routes
- Web: `M/(shell)/shipments/page.tsx`, `M/components/ShipmentsTab.tsx`, `M/(shell)/routing/[shipmentId]/page.tsx`, `components/RouteMap/RouteMap.tsx`, `util/tracking.ts`, `util/navigation.ts`.
- Endpoints: `POST /merchants/me/shipments` (order ids, max 20), `GET /merchants/me/shipments`, shipment tracking for one shipment (same call as web `fetchmMerchantShipmentTracking`) and its route geometry (`RouteGeometryResponse`: GeoJSON LineString), `POST /merchants/me/orders/{id}/pin-unreachable`.
- Build: list of ready orders with checkboxes (cap at 20 with a clear message), "Make route" → shows `skipped_orders` with reasons (`no_location`, `no_road`) in plain words; shipment list; route screen with `react-native-maps` (pickup marker, numbered stop markers, `Polyline` from the GeoJSON coordinates `[lng, lat]` → `{ latitude, longitude }`), stop list with planned arrival, "Open in Google Maps / Apple Maps" per stop (`util/navigation.ts` logic, as a pure lib), "Pin unreachable" action.
- Rate limit: `shipment_create` is 30 per merchant per hour; show the 429 message from the server.
- Done: create a route for 2+ orders, see it on the map, open navigation to a stop.

### 5.5 Earnings and payouts
- Web: `M/(shell)/earnings/page.tsx`, `M/components/EarningsTab.tsx`, `M/components/CashOutPanel.tsx`; `SYSTEM_REFERENCE.md` 7.7.
- Endpoints: `GET /merchants/me/payout-info`, payout institutions (web `fetchPayoutInstitutions`), `POST /merchants/me/payout-info/code`, `PUT /merchants/me/payout-info`, `GET /merchants/me/payouts`, `GET /merchants/me/transactions`, `GET /merchants/me/payouts/available`, `POST /merchants/me/payouts/request`, `GET /merchants/me/sales?days=30|90`, `GET /merchants/me/sales/export?days=7|30|90`.
- Build: available balance + transfer fee + "Cash out" (confirm dialog, disabled when nothing available or no destination); payout destination form (bank / GCash / Maya, institution picker) with the SMS code step: request code for the exact destination, enter code, save; payout history; transaction list; sales summary; CSV export (download with `expo-file-system`, open share sheet with `expo-sharing`).
- Mask account numbers the same way the web shows them. Never log them.
- Show the known GCash issue only if the web shows it.
- Done: change destination with a code, request a payout, export CSV and share it.

### 5.6 Reviews (exists from Plan 1). Check it against `M/components/ReviewsTab.tsx` and `lib/review-reply.ts`; add any filter or sort the web has.

### 5.7 Produce (extend)
- Web: `M/(shell)/produce/page.tsx`, `M/components/ProduceTab.tsx`, `M/components/ProduceFormFields.tsx`, `util/api/produce.ts`, `lib/input-limits.ts`.
- Endpoints: existing create/update/delete + `POST /produce/{id}/image`.
- Build: photo pick/take with `expo-image-picker`, upload after create (and on edit), show a placeholder until uploaded. Field-level errors under each field (standard 2.1).
- Done: a new listing with a photo shows on the buyer farm page.

### 5.8 Inventory
- Web: `M/(shell)/inventory/page.tsx`, `M/components/StockAlertsPanel.tsx`, `M/components/DemandInsight.tsx`.
- Endpoints: `GET /merchants/me/stock-alerts`, `PATCH /merchants/me/stock-alerts` (`low_stock_threshold`), `GET /merchants/me/demand`, `PATCH /produce/{id}` for quick stock edits.
- Build: stock list with quick +/− or edit, low-stock / expiring / expired groups, threshold setting, demand insight (most ordered, most searched in province and Luzon, unmet searches; reuse `dashboard.ts` helpers).

### 5.9 Shop page
- Web: `M/(shell)/shop/page.tsx`, `M/components/ShopTab.tsx`, `lib/shop-slug.ts`, `lib/farm-images.ts`; `SYSTEM_REFERENCE.md` 7.4 shop page rules.
- Endpoints: `GET/POST/PATCH /merchants/me/shoppage`, `POST .../publish`, `.../unpublish`, `.../discard`, `POST .../logo`, `POST .../banner`.
- Build: draft editor (title, slug with live format check, description), logo and banner upload (each upload changes only the draft), state chip (not published / live / live with unpublished changes), Publish, Discard changes (only when published before), Unpublish (confirm: the farm is hidden from buyers; open orders continue). Preview link opens the public farm page on the web.
- Done: first publish makes the farm appear in the buyer app's farm list.

### 5.10 Vouchers
- Web: `M/(shell)/vouchers/page.tsx`, `M/components/VouchersTab.tsx`, `lib/vouchers.ts`, `util/api/vouchers.ts`.
- Endpoints: `GET/POST /merchants/me/vouchers`, `PATCH/DELETE /merchants/me/vouchers/{id}`.
- Build: list, create form (same rules as `lib/vouchers.ts`), on/off switch, delete only unused ones (as web), copy code.

### 5.11 Store settings
- Web: `M/(shell)/settings/page.tsx`, `M/components/StoreDetails.tsx`, `M/components/HolidayModePanel.tsx`, `M/components/DangerZone.tsx`, `lib/store-pause.ts`, `lib/phone.ts`.
- Endpoints: `GET/PATCH /merchants/me`, `PUT/DELETE /merchants/me/pause`, `POST /merchants/me/delete-code`, `DELETE /merchants/me`, `POST /locations/geocode`, `POST /locations/reverse-geocode`, PSGC lookups (same source as web `util/psgc.ts`).
- Build: store details (pickup address with the standard 2.3 pin flow, delivery days and price, contact number), holiday mode (pause until a date with a message, resume), danger zone (send code, enter code, delete merchant profile; after delete, return to `/not-merchant`).
- Done: address saves with `pin_confirmed`; NCR shows Metro Manila; pausing hides the shop in the buyer app.

### 5.12 Onboarding (native, replaces the web hand-off from Plan 1)
- Web: `M/onboarding/page.tsx` (1164 lines, the main spec), `M/onboarding/ContactCodeField.tsx`, `M/onboarding/DocumentDropzone.tsx`, `util/api/merchants.ts` (`submitMyMerchantOnboarding`, `fetchMyMerchantApplication`), `util/serviceArea.ts`; `SYSTEM_REFERENCE.md` 7.4.
- Endpoints: `GET /merchant-applications/me`, `POST /merchant-onboarding/me` (multipart: `payload`, `rsbsa_file`, `gov_id_file`, and any other file part the web sends), `POST /sms/otp/send` + `/sms/otp/verify` (purpose `merchant_phone`), `POST /email/otp/send` + `/email/otp/verify` (purpose `merchant_email`). These OTP calls are signed-in and need no captcha.
- Build: the same 2 steps as the web `STEPS` (operations, then legal and documents), progress "1 / 2", seller types, "Submit later" (sends step 1 and seller type only, like the web), `?step=business` deep link opens the legal step, server errors go to the first step with a problem and under each field, contact code fields with resend cooldown (`hooks/useResendCooldown` logic as a pure lib), document pick with `expo-document-picker` (type and size checked before upload), pickup address with the standard pin flow, application status screen (submitted / needs changes with the admin's notes / approved).
- Rate limit `onboarding_submit` 10 per hour: show the server's 429 message.
- Phone required: a Google/Facebook account without a verified phone gets `PHONE_VERIFICATION_REQUIRED`; send the user to the phone verify sheet, then back.
- Done: a new account applies fully on the phone; the admin sees the application with both documents.

### 5.13 Account basics
- Idle logout (`idle.ts`), sign out, "Open buyer app", "Merchant Centre on the web". Whole-account deletion stays in the buyer app; the merchant app only deletes the merchant profile (5.11).

## 6. Phases (in order)

1. **Foundation**: `MerchantContext`, tab badges, final More menu, new deps installed, multipart support in `request`, `inStep.test.ts` checks for every shared constant.
2. **Daily work**: 5.2 Orders, 5.3 Chats + inquiries, 5.7 Produce photos, 5.8 Inventory.
3. **Money**: 5.5 Earnings and payouts.
4. **Delivery**: 5.4 Shipments and route map.
5. **Shop setup**: 5.9 Shop page, 5.10 Vouchers, 5.11 Store settings.
6. **Onboarding**: 5.12 native onboarding; remove the web hand-off from Plan 1 (keep a "Continue on the web" link as a fallback).
7. **Dashboard polish**: 5.1 checklist, charts, attention list.
8. **Docs**: README (run, env vars, map key, known gaps), `SYSTEM_REFERENCE.md` sections 1 and 4.3 (merchant app), `SUBDOMAINS.md` 1.5 note that the mobile merchant app reads `/merchantDashboard` notification links by kind.

## 7. Parity checklist (done when every row is yes)

| Web page | Mobile screen | Yes? |
|---|---|---|
| `/` Dashboard | Home | |
| `/sales` | Orders | |
| `/chats` | Chats (Orders + Questions) | |
| `/shipments`, `/routing/<id>` | More → Shipments, Route | |
| `/earnings` | More → Earnings | |
| `/reviews` | More → Reviews | |
| `/produce` | Produce | |
| `/inventory` | More → Inventory | |
| `/shop` | More → Shop page | |
| `/vouchers` | More → Vouchers | |
| `/settings` | More → Store settings | |
| `/onboarding` | Onboarding (outside the gate) | |
| `/auth` | Auth | |

## 8. Out of scope
- Backend changes, admin features (admins are web-only, `ADMIN_WEB_ONLY`).
- Push notifications (keep polling), offline mode, app store submission, final icons and splash.
- A shared code package between the two apps (keep Plan 1's copies + `sharedCopies.test.ts`).
