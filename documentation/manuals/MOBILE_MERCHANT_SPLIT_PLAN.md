# Plan 1: Move merchant features out of CarabaoMobile into CarabaoMerchantMobile

Status: draft plan, 2026-11-22. Do this plan first. Plan 2 (`MERCHANT_MOBILE_APP_PLAN.md`) builds on its result.

## 0. Goal

- `mobile/CarabaoMobile` becomes a buyer-only app. It has no merchant screens, no merchant API calls and no merchant role gate.
- `mobile/CarabaoMerchantMobile` (empty now) becomes a new Expo app that contains every merchant screen that exists in the buyer app today, working the same way.
- No new merchant features in this plan. Copy behaviour, do not redesign. New features are Plan 2.

## 1. Rules for the agent doing this work

1. Do not change the backend (`backend/`). Only two small web files change (section 6).
2. Do not change `documentation/manuals/DB_ROLE_SPLIT_PLAN.md`.
3. Keep the existing code style: pure logic in `src/lib/*.ts` with a `*.test.ts` next to it (run by `node --test`, imports end in `.ts`, no `react-native` import in a pure module). Screens in `src/screens`, route files in `app/` are 1-line re-exports.
4. Keep existing `CF-xxxx` comments. Do not invent new CF numbers.
5. Move files with `git mv` where the file leaves the buyer app, so history follows. Copy (not move) files that both apps need.
6. After each phase, run in **both** apps: `npx tsc --noEmit`, `npm run lint`, `npm test`. All must pass before the next phase.
7. Never log tokens, emails or phone numbers. `src/lib/logGuard.test.ts` checks this; it must exist in both apps.

## 2. File inventory (current buyer app)

Paths are relative to `mobile/CarabaoMobile/`.

### 2.1 Merchant-only: MOVE to the merchant app, delete from the buyer app

| File | Notes |
|---|---|
| `app/merchant-dashboard.tsx` → `src/screens/MerchantDashboardScreen.tsx` | dashboard |
| `app/merchant-orders.tsx` → `src/screens/MerchantOrdersScreen.tsx` | incoming orders, status changes, cancel |
| `app/merchant-chats.tsx` → `src/screens/MerchantChatsScreen.tsx` | chat inbox; opens `/order-chat` |
| `app/merchant-reviews.tsx` → `src/screens/MerchantReviewsScreen.tsx` | reviews + reply |
| `app/listings.tsx` → `src/screens/ListingsScreen.tsx` | merchant's own produce list, create/edit/delete |
| `app/onboarding.tsx` → `src/screens/OnboardingScreen.tsx` | "become a merchant"; today opens the web form |
| `src/components/ListingForm.tsx` | |
| `src/components/CancelOrderSheet.tsx` | farm cancel reasons |
| `src/lib/listingForm.ts` + `.test.ts` | |
| `src/lib/dashboard.ts` + `.test.ts` | |
| `src/lib/chatInbox.ts` + `.test.ts` | |
| `src/lib/access.ts` + `.test.ts` | merchant role decision |

### 2.2 NOT merchant activity: KEEP in the buyer app only

Do not move these even though the names say "merchant" or "farm":

| File | Why it stays |
|---|---|
| `app/merchant.tsx` → `src/screens/MerchantScreen.tsx` | the **buyer** view of a farm's shop page (add to cart, follow) |
| `src/components/FarmCard.tsx`, `src/components/FarmReviews.tsx` | buyer browsing |
| `src/lib/farms.ts` | buyer farm cards (the merchant app copies only `ratingLabel`, see 2.4) |
| `src/lib/referencePrices.ts` | used by the buyer farm page |
| cart, checkout, saved, search, track, history, addresses, receipt, vouchers (buyer voucher entry) | buyer flows |

### 2.3 Needed by both: COPY into the merchant app, keep in the buyer app

Copy these unchanged unless the "Change" column says otherwise. Put this first line on each copy:
`// Shared with mobile/CarabaoMobile/<same path>. Keep both copies the same (sharedCopies.test.ts).`

| File | Change in the merchant copy |
|---|---|
| `src/lib/apiErrors.ts` + test | none |
| `src/lib/baseUrl.ts` + test | none |
| `src/lib/config.ts` | none |
| `src/lib/idle.ts` + test | none |
| `src/lib/imageUri.ts` + test | none |
| `src/lib/inputLimits.ts` + test | none |
| `src/lib/livePolling.ts` + test, `src/lib/polling.ts` + test, `src/lib/usePolling.ts` | none |
| `src/lib/sessionEvents.ts` | none |
| `src/lib/theme.ts` | none (Plan 2 may give the merchant app its own accent colour) |
| `src/lib/orderStatus.ts` | none |
| `src/lib/passwordPolicy.ts` + test, `src/lib/phone.ts` + test | none |
| `src/lib/notificationList.ts` + test, `src/lib/notificationPrefs.ts` + test | none |
| `src/lib/webPages.ts` + test | none |
| `src/lib/logGuard.test.ts` | none (it scans its own app's `src` and `app`) |
| `src/components/UI.tsx`, `src/components/Skeleton.tsx` | none |
| `src/components/PasswordResetSheet.tsx`, `src/components/PhoneVerifySheet.tsx`, `src/components/AddEmailSheet.tsx` | none |
| `src/lib/authClient.ts` | **different**: `APP_SCHEME = 'carabaomerchant'`, `storagePrefix: 'carabao-merchant'`. Not in the same-file check. |
| `src/lib/AuthContext.tsx` | copy, then remove anything cart- or buyer-only if present. Not in the same-file check. |
| `src/screens/AuthScreen.tsx` | copy; title/subtitle say "Carabao Merchant". Not in the same-file check. |
| `src/screens/OrderChatScreen.tsx` (+ `src/lib/orderDetail.ts` parts it needs) | copy; merchant opens it from orders and chats. Only keep the `orderDetail` helpers the chat uses (`chatTitle`, `parseOrderId`) in a merchant `src/lib/orderChat.ts`. |
| `src/lib/inStep.test.ts` | **split**: the merchant copy keeps only the checks for files the merchant app has (order status, password policy, phone, review reply). The buyer copy drops the review-reply test only if `REPLY_MAX_LENGTH` leaves the buyer `reviews.ts` (see 3.4). |
| `hooks/` (`use-color-scheme` etc.) | copy the ones `app/_layout.tsx` uses |

### 2.4 Files to SPLIT (part stays, part moves)

| File | Buyer keeps | Merchant app gets |
|---|---|---|
| `src/lib/api.ts` | `request`, `ApiError`, buyer types, `api.merchants.list/byId/produce` (public), public reviews, follows, cart, orders/me, produce search, saved, chat (`/orders/{id}/messages`), notifications, users, addresses | its own `src/lib/api.ts`: copy `request`/`ApiError` and the types it needs; methods: `users.me`, `merchants.myProduce/orders/chats/performance/demand/myReviews/reply/deleteReply/stockAlerts/updateOrderStatus/cancelOrder`, `produce.create/update/delete`, chat messages, notifications |
| `src/lib/reviews.ts` + test | public farm reviews (`MerchantReviews`, `PublicReview`, `shownReply`) | "my reviews" + reply (`MyMerchantReviews`, `MyReview`, `myReviewsQuery`, `REPLY_MAX_LENGTH`, reply checks) in `src/lib/myReviews.ts` + test |
| `src/lib/farms.ts` | everything | `ratingLabel` only, put in merchant `src/lib/format.ts` (+ test) |
| `src/lib/notificationLinks.ts` + test | buyer links; merchant links change (3.3) | merchant links only (all `/merchantDashboard...` links) |
| `src/components/ProtectedScreen.tsx` | sign-in gate only (3.2) | not copied; the merchant app gates in its root layout (4.3) |

## 3. Changes in the buyer app (`mobile/CarabaoMobile`)

### 3.1 Routes
- Delete `app/merchant-dashboard.tsx`, `app/merchant-orders.tsx`, `app/merchant-chats.tsx`, `app/merchant-reviews.tsx`, `app/listings.tsx`, `app/onboarding.tsx`.
- Remove their `<Stack.Screen>` lines from `app/_layout.tsx`. Keep `merchant` (buyer farm page).

### 3.2 `ProtectedScreen`
- Remove `requiredRole` and the `/users/me` merchant check. It only sends signed-out users to `/auth`.
- Delete every `requiredRole="merchant"` use (should be none left after 3.1; grep to confirm).
- `access.ts` moves to the merchant app (2.1). If the buyer still needs `decideAccess` for the sign-in case, inline the 3-line check in `ProtectedScreen`.

### 3.3 Hand-off to the merchant app ("Open Carabao Merchant")
Add `src/lib/merchantHandoff.ts` (pure) + test:
- `MERCHANT_APP_URL = 'carabaomerchant://'`
- `merchantWebUrl(webBase, kind: 'dashboard' | 'onboarding')` → `${webBase}/merchantDashboard` or `${webBase}/merchantOnboarding` (both redirect to the `merchant.` host, see `SUBDOMAINS.md` 1.1).
- `merchantAppPath(kind, notificationKind?)` → the path inside the merchant app (`/`, `/orders`, `/reviews`, `/chats`, `/onboarding`). Use the same kind mapping the merchant app uses (4.5).

Add a small helper (not pure) `openMerchant(kind, notificationKind?)` in `src/lib/openMerchant.ts`:
1. `Linking.canOpenURL(MERCHANT_APP_URL + path)` → open it.
2. Otherwise `WebBrowser.openBrowserAsync(merchantWebUrl(...))`.

`app.json`: add the scheme to the queries so `canOpenURL` works:
- iOS: `"ios": { "infoPlist": { "LSApplicationQueriesSchemes": ["carabaomerchant"] } }`
- Android: `"android": { "intentFilters"` is not needed; add the query with the config plugin approach Expo SDK 58 documents for `<queries>` (if not available, `canOpenURL` may return false on Android 11+; then the web fallback runs, which is acceptable for the draft).

### 3.4 Profile screen (`src/screens/ProfileScreen.tsx`)
- Replace the merchant block (banner + Dashboard / Incoming orders / My listings / Chats / Reviews rows, lines ~130-185) with one banner:
  - merchant (`profile.merchant` set): title = farm name, subtitle "Manage your farm in Carabao Merchant", press → `openMerchant('dashboard')`.
  - not a merchant: title "Sell on Carabao", subtitle "Set up your farm in the Carabao Merchant app", press → `openMerchant('onboarding')`.
- Remove styles that are no longer used.

### 3.5 Notifications
- In the buyer `notificationLinks.ts`, a `/merchantDashboard...` link now returns `{ merchant: <notification kind> }` instead of a `/merchant-*` pathname. Update the union type and tests.
- In `NotificationsScreen.tsx`, a `{ merchant }` result calls `openMerchant('dashboard', kind)`. Merchant notifications still show in the buyer list (same account, same endpoint); they just hand off.
- The buyer chat-notification case for `/merchantDashboard?order=12` also hands off (the merchant app opens that chat).

### 3.6 `api.ts`
- Delete the merchant-owner methods listed in 2.4 and the types only they use (`ApiMerchantOrder`, `MerchantOrderStatus`, `ApiStockAlerts`, `ApiStockAlertItem`, `ProduceCreatePayload`, `ProduceUpdatePayload`, the `dashboard`/`chatInbox` imports) once nothing in the buyer app imports them. Let `tsc` find leftovers.

### 3.7 Acceptance (buyer app)
- `grep -rnE "merchant-(orders|dashboard|chats|reviews)|/listings'|/onboarding'|merchants/me|requiredRole" src app` → no results.
- tsc, lint, test pass.
- Manual: buyer can browse a farm (`/merchant?id=`), order, chat with a farm, read notifications. Profile shows the single merchant banner.

## 4. The new merchant app (`mobile/CarabaoMerchantMobile`)

### 4.1 Scaffold
Do not run `create-expo-app` with a template that brings different versions. Instead copy these from `CarabaoMobile` and edit:
- `package.json`: `"name": "carabaomerchantmobile"`, same scripts, **same dependency versions** (Expo SDK 58, RN 0.88.1, React 19.3.0, expo-router ~58.0.32, better-auth ^1.7.26 ...). Drop nothing yet; Plan 2 adds more.
- `tsconfig.json`, `eslint.config.js`, `expo-env.d.ts`, `.gitignore`, `.vscode/` (if useful), `assets/` (icons can be the same image for now; mark "TODO merchant icon" in README).
- `app.json`:
  - `"name": "Carabao Merchant"`, `"slug": "CarabaoMerchantMobile"`, `"scheme": "carabaomerchant"`.
  - Keep plugins, `typedRoutes`, `reactCompiler`.
  - Leave `ios.bundleIdentifier` / `android.package` unset or set to placeholders `online.carabao.merchant` with a `TODO confirm` note in README. They must differ from the buyer app's.
- `README.md`: how to run, env vars (same `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES` as `SYSTEM_REFERENCE.md` 4.3), and that sign-in needs the web change in section 6.
- Run `npm install` to create `package-lock.json`.

### 4.2 Folder layout
```
app/
  _layout.tsx           providers + Stack + merchant gate
  auth.tsx              sign-in (AuthScreen)
  not-merchant.tsx      "This app is for farm accounts" + Apply button
  onboarding.tsx        OnboardingScreen (moved; still opens the web form)
  (tabs)/_layout.tsx    Home, Orders, Chats, Produce, More
  (tabs)/index.tsx      MerchantDashboardScreen
  (tabs)/orders.tsx     MerchantOrdersScreen
  (tabs)/chats.tsx      MerchantChatsScreen
  (tabs)/produce.tsx    ListingsScreen
  (tabs)/more.tsx       MoreScreen (new, small)
  reviews.tsx           MerchantReviewsScreen
  order-chat.tsx        OrderChatScreen
  notifications.tsx     NotificationsScreen (merchant copy, see 4.5)
src/lib, src/components, src/screens   as in section 2
hooks/
```
Route names drop the `merchant-` prefix inside this app. Update every `router.push` in moved screens (for example `/merchant-orders` → `/(tabs)/orders`, `/listings` → `/(tabs)/produce`). `typedRoutes` will flag misses.

### 4.3 Root gate (`app/_layout.tsx`)
Providers: `GestureHandlerRootView` → `SafeAreaProvider` → `AuthProvider` → `ThemeProvider` → `Stack`. No `CartProvider`, no `SavedProvider`.

Add `src/lib/MerchantContext.tsx` (or a `useMerchantGate` hook) that, when signed in, calls `api.users.me` once per user and exposes `{ status: 'wait' | 'signin' | 'allowed' | 'forbidden' | 'error', profile, retry }` using `decideAccess` from the moved `access.ts` with `required = 'merchant'`.
- `signin` → redirect to `/auth`.
- `forbidden` → redirect to `/not-merchant` (button "Apply to sell" → `/onboarding`; button "Sign out").
- `error` → full-screen "Could not check your account" + "Try again" (same text as old `ProtectedScreen`).
- `allowed` → tabs.
- Merchant screens must not mount (and must not call `/merchants/me/*`) before `allowed`. Keep the CF-0120 comment from `access.ts`.

`access.ts`: remove the `'admin'` branch only if tests are updated; simpler is to keep it as is.

### 4.4 More tab (`src/screens/MoreScreen.tsx`, new, small)
Rows: Reviews, Notifications, "Open buyer app" (`carabaomobile://`, web fallback `WEB_BASE`), "Merchant Centre on the web" (`${WEB_BASE}/merchantDashboard`), Sign out. Show farm name and verification status (`verificationBanner` from `dashboard.ts`) at the top. Plan 2 adds more rows.

### 4.5 Notifications in the merchant app
- Merchant `notificationLinks.ts`: map `/merchantDashboard` links by kind, the same way the web bell does (`SUBDOMAINS.md` 1.5): `new_order` → `/(tabs)/orders`, `chat_message` → the chat for `?order=<id>` if present, else `/(tabs)/chats`, `review_received` → `/reviews`, `payout_released` / `payout_destination_changed` → `/` for now (Plan 2 adds Earnings). Others → `/`.
- The merchant notifications screen lists only merchant notifications (link starts with `/merchantDashboard`). Write the filter as a pure function with a test. Buyer notifications stay in the buyer app.
- Accept deep links `carabaomerchant://orders`, `carabaomerchant://reviews`, `carabaomerchant://chats?order=12`, `carabaomerchant://onboarding` (expo-router maps the scheme to routes automatically; check each one opens the right screen after the gate).

### 4.6 Shared-copy guard
Add `src/lib/sharedCopies.test.ts` in the merchant app: for each file in the 2.3 "none" list, read it from both apps (`../../../CarabaoMobile/<path>`), drop the first comment line from the merchant copy, and assert the rest is equal. If the buyer app folder is missing, skip with a message. This keeps the copies from drifting until a real shared package exists.

### 4.7 Acceptance (merchant app)
- tsc, lint, test pass.
- Sign in with a merchant account → tabs. Dashboard, orders (change status, cancel with reason), chats (open a chat, send), produce (create, edit, delete), reviews (reply, delete reply) all work as in the buyer app before.
- Sign in with a non-merchant → `/not-merchant`; "Apply to sell" opens the web onboarding.
- No call to `/merchants/me/*` happens before the gate says `allowed` (check the network log in dev).
- Admin account: sign-in is refused with `ADMIN_WEB_ONLY` (section 6 keeps this true).

## 5. Phases (do them in order, commit after each)

1. **Scaffold** the merchant app (4.1, 4.2 empty screens), copy shared files (2.3) + `sharedCopies.test.ts`. App boots to a sign-in screen.
2. **Auth + gate**: authClient with the new scheme, AuthScreen, root gate, not-merchant screen. Needs section 6 on the local web server.
3. **Move screens**: `git mv` the 2.1 files into the merchant app, split `api.ts`, `reviews.ts`, `farms.ts` (2.4). Fix routes. Merchant app feature-complete for today's scope.
4. **Strip the buyer app**: section 3 (routes, ProtectedScreen, Profile banner, handoff, notifications, api cleanup).
5. **Docs**: update `SYSTEM_REFERENCE.md` 4.3 (two mobile apps, same env vars), 7.2 "Mobile" line (both schemes), and the components list in section 1; add the `carabaomerchant` scheme to `SUBDOMAINS.md` 1.2 trusted origins row.

## 6. Web changes required (small, outside `mobile/`)

Sign-in for both apps goes through Better Auth on the website, which only trusts listed origins.

1. `frontend/carabao-app/lib/auth.ts` (~line 102): add the merchant scheme next to `carabaomobile`:
   ```ts
   const MOBILE_APP_SCHEMES = ["carabaomobile", "carabaomerchant"];
   const mobileOrigins = [
     ...MOBILE_APP_SCHEMES.map((s) => `${s}://`),
     ...(process.env.NODE_ENV !== "production" ? ["exp://", "exp://**"] : []),
   ];
   ```
2. `frontend/carabao-app/lib/admin-two-factor.ts` (~line 88): add `"carabaomerchant://"` to `MOBILE_ORIGIN_PREFIXES`, so admin sign-in from the merchant app is refused like from the buyer app. Update its test if it lists prefixes.
3. Run the web tests (`npm test` in `frontend/carabao-app`).

## 7. Out of scope here
- New merchant features (shipments, earnings, shop page, vouchers, settings, native onboarding, inventory threshold, inquiries): Plan 2.
- A shared npm workspace / package for common code. Copies + the guard test are enough for now; revisit after Plan 2.
- Push notifications, store submission, app icons.
