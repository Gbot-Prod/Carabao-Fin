# Merchant split: runnable sections (companion to MOBILE_MERCHANT_SPLIT_PLAN.md)

Status: working checklist, 2026-11-22. `MOBILE_MERCHANT_SPLIT_PLAN.md` stays the source of
truth for *what* changes; this file only splits it into sections that can be executed and
verified one at a time, in this order. Do not reorder sections without rereading §5 (the
dependency line of each section) and §6 (traceability).

## 0. How to use this file

- Do one section per task. Never start the next section with a failing check.
- Every section ends with the same three checks in **both** mobile apps and, where the web
  changed, in `frontend/carabao-app`. Rules 1-7 of the plan apply to every section
  (no `backend/` changes, pure logic + `*.test.ts`, keep `CF-xxxx` comments, `git mv` for
  files that leave the buyer app, never log tokens/emails/phones).
- "Verify" commands are written for PowerShell from the repo root.

## 1. Facts checked against the repo (2026-11-22)

| Fact | Value |
|---|---|
| `mobile/CarabaoMerchantMobile/` | exists, **0 files** (nothing to preserve) |
| Buyer `app/` / `src/screens` | 27 route files / 23 screens; all six §2.1 routes exist |
| `src/lib/api.ts` | 730 lines; merchant-owner methods = 515-546 (508-514 `list/get/produce` stay, buyer farm page), `produce.create/update/remove` = 593-607; core = 17-107 |
| Merchant-only types in `api.ts` | `ProduceCategory/Unit/Create/UpdatePayload` 161-184, `MerchantOrderStatus`/`ApiMerchantOrder` 422-445, `ApiStockAlertItem`/`ApiStockAlerts` 487-503 |
| Merchant-only imports in `api.ts` | `./reviews` (10), `./dashboard` (11), `./chatInbox` (12) |
| `api.produce.*` callers | `ListingsScreen` only |
| `api.users.me` callers | `ProfileScreen` (buyer), `ListingsScreen` (merchant), gate (new) |
| `src/components/ProtectedScreen.tsx` | imports `../lib/access` + calls `api.users.me`; five buyer screens pass `requiredRole="merchant"`, so S4 must keep the prop (ignored) until S8-S10 move them |
| `src/screens/ProfileScreen.tsx` | `router.push('/merchant-dashboard'|'/merchant-orders'|'/merchant-chats'|'/merchant-reviews'|'/listings')` (~130-185), so plan §3.4's banner must land in S8 with the first route deletions |
| `api.chat.*` / `api.notifications.*` | used by both apps |
| Pure libs with no imports | `dashboard.ts`, `chatInbox.ts`, `listingForm.ts` (move cleanly) |
| `hooks/` | `use-color-scheme.ts`, `use-color-scheme.web.ts` only |
| §6 anchors | `frontend/carabao-app/lib/auth.ts:102`, `lib/admin-two-factor.ts:88` (both as written) |

## 2. Where the plan needed a decision (resolved here)

1. **Buyer must stay green after every section** (plan rule 6). The plan deletes the buyer
   route files in §3.1 (phase 4) but moves the screens out in phase 3, which leaves
   `app/merchant-*.tsx` or `_layout.tsx` pointing at deleted files. Fix: each screen is moved
   together with its buyer route file and its `<Stack.Screen>` line (S8-S10). Order chat stays
   in the buyer app (shared feature) and is *copied* (S11).
2. **The gate needs `api.users.me`**, so the merchant `src/lib/api.ts` core is created in S3;
   S7 only adds the merchant methods. Plan phase 1/3 would otherwise depend on phase 3.
3. **`access.ts` moves in S4, not S6.** Plan groups it under §2.1 (phase 3), but §4.3 needs
   `decideAccess` for the gate, so it is moved with `git mv` in S4 and the merchant app keeps
   the CF-0120 comment.
4. **`src/lib/reviews.ts` is not a clean split.** `stars`, `reviewSummary`, `mergeReviews`,
   `wasEdited`, `shownReply` are used by *both* `FarmReviews.tsx` (buyer) and
   `MerchantReviewsScreen.tsx`; `farmReplyLabel` is buyer-only; reply authoring and "my
   reviews" are merchant-only. S6 creates the merchant `myReviews.ts`, S10 switches the screen
   to it, S14 removes the merchant half from the buyer file.
5. **`api.produce.*` must leave the buyer app** too (plan §2.4 gives those three methods to
   the merchant app; §3.6 only names `merchants.*`). Done in S14.
6. **`CustomTabBar.tsx` is buyer-only** (cart tab). The plan does not say what draws the
   merchant tab bar. See Decision D1 before S5.
7. `inStep.test.ts`'s repo-root math (`'..','..','..','..'`) is the same depth from
   `mobile/CarabaoMerchantMobile/src/lib`, so the merchant copy needs no path change.
8. **Buyer `notificationLinks.ts` names merchant routes** (`/merchant-orders` etc.). The plan
   (§3.5) keeps merchant notifications in the buyer list and hands them to the merchant app,
   so those branches return `{ merchant: <kind> }` instead of a route. Because the route
   deletions and that change must land together (typed routes), both are in S8, with the
   handoff helpers from plan §3.3. The merchant gets its own mapping of real routes in S12.
9. **Buyer `ProtectedScreen` imports `access.ts`.** Moving `access.ts` in S4 breaks the buyer,
   so the same commit strips `ProtectedScreen` down to a sign-in wrapper (plan §3.2) and keeps
   its `requiredRole` prop accepted but ignored until S14. Same for the profile banner: buyer
   `ProfileScreen` pushes `/merchant-*` routes, so plan §3.4 lands in S8.
10. **`listingForm.ts` was not fully merchant-only.** Buyer `src/lib/checkoutOptions.ts` and
    `src/screens/CheckoutScreen.tsx` import its `addDays`/`phToday`, so S9 splits those two
    pure helpers into a new shared copy, `src/lib/dates.ts` (both apps, guarded by
    `sharedCopies.test.ts`). Merchant `listingForm.ts` re-exports them, so its API, its test
    and every message stay as they were.

## 3. Decisions to confirm (defaults in brackets)

- **D1 merchant tab bar** — [default `Tabs` + `Ionicons` `tabBarIcon`, no new dependency] vs a
  merchant copy of `CustomTabBar`.
- **D2 reviews split shape** — [default: merchant `src/lib/myReviews.ts` holds shared display
  helpers + my-reviews + reply rules; buyer keeps `reviews.ts` with display helpers + public
  types] vs two merchant files (`reviews.ts` + `myReviews.ts`).
- **D3 merchant `api.ts` size** — [default: drop buyer-only types/methods (cart, addresses,
  orders/history, payments, tracking, saved, follows, search, reorder, support) and keep only
  what merchant screens and the gate call].

## 4. Section map (plan section -> section id)

| Plan | Sections |
|---|---|
| §4.1 scaffold | S1, S2 |
| §5 phase 2 auth + gate, §6 web | S3, S4 |
| §4.2 layout / §4.4 More | S5 |
| §2.3-§2.4 splits | S6 (`format`/`orderChat`/`myReviews`), S7 (api), S12 (notificationLinks) |
| §2.1 moves / §4.2 routes | S8 (dashboard/orders/chats), S9 (listings/onboarding), S10 (reviews) |
| §2.3 OrderChatScreen copy | S11 |
| §4.5 notifications | S12 |
| §4.7 merchant acceptance | S13 |
| §3.1-§3.2, §3.6 buyer strip | S14 |
| §3.3-§3.5 handoff (helpers, profile banner, notification hand-off) | S8 |
| §3.7 buyer acceptance | S15 |
| §5 phase 5 docs | S16 |

## 5. Sections

### S0 - Baseline (no code change)

**Depends on:** nothing.
**Do**
1. `git status --porcelain` - at the time of writing (2026-11-22, branch `main`):
   `M documentation/manuals/DB_ROLE_SPLIT_PLAN.md` plus untracked `MERCHANT_MOBILE_APP_PLAN.md`,
   `MOBILE_MERCHANT_SPLIT_PLAN.md`, `MOBILE_MERCHANT_SPLIT_SECTIONS.md`. Nothing under
   `mobile/` or `backend/` is dirty.
2. In `mobile/CarabaoMobile`: `npx tsc --noEmit` (clean), `npm run lint` (clean),
   `npm test`.
3. Record the versions in `mobile/CarabaoMobile/package.json` (expo ^58.0.0, RN 0.88.1,
   react 19.3.0, expo-router ~58.0.32, better-auth ^1.7.26, typescript ~6.0.3) - S1 copies
   them verbatim.
**Baseline recorded (2026-11-22, branch `main`):** `git status --porcelain` shows only
documentation changes - `M "documentation/manuals/Admin creation.md"`,
`M documentation/manuals/DB_ROLE_SPLIT_PLAN.md`, `M documentation/manuals/SUBDOMAINS.md`,
no untracked files (this plan and the sections file are already committed). Nothing under
`mobile/` or `backend/` is dirty.
Buyer (`mobile/CarabaoMobile`): `npx tsc --noEmit` exit 0, `npm run lint` exit 0 (no
errors/warnings), `npm test` 169 tests / 169 pass / 0 fail (node `duration_ms` 487).
Versions confirmed verbatim in `package.json`: expo ^58.0.0, react-native 0.88.1,
react 19.3.0 (react-dom 19.3.0), expo-router ~58.0.32, better-auth ^1.7.26
(@better-auth/core, @better-auth/expo also ^1.7.26), typescript ~6.0.3 - S1 copies them.
Every later buyer count is compared with 169 (it must hold at S1-S13, drop only where
S4/S14 delete tests, and stay green).
**Verify:** all three pass.
**Done when:** the buyer app is green and the baseline is written down.
**Commit:** none.

---

### S1 - Merchant app scaffold (plan §4.1)

**Depends on:** S0.
**Do** (new app only, buyer untouched)
1. Create `mobile/CarabaoMerchantMobile/` files by copying from `CarabaoMobile`, then edit:
   - `package.json`: `"name": "carabaomerchantmobile"`, same `scripts`
     (`start/android/ios/web/lint/test`, `test` = `node --test "src/lib/**/*.test.ts"`),
     same dependency and devDependency versions.
   - `tsconfig.json`, `eslint.config.js`, `expo-env.d.ts`, `.gitignore`, `.vscode/`,
     `assets/` (same images for now).
   - `app.json`: `"name": "Carabao Merchant"`, `"slug": "CarabaoMerchantMobile"`,
     `"scheme": "carabaomerchant"`, keep `plugins`, `typedRoutes`, `reactCompiler`;
     `ios.bundleIdentifier` / `android.package` = `online.carabao.merchant` with a
     `TODO confirm` note in the README (must differ from the buyer app).
   - `README.md`: how to run, the three env vars from `SYSTEM_REFERENCE.md` §4.3
     (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_IDLE_TIMEOUT_MINUTES`),
     "sign-in also needs the web change in the plan §6", `TODO merchant icon`.
2. Minimum bootable tree: `app/_layout.tsx` (Stack with one placeholder route) and
   `app/index.tsx` (placeholder text). expo-router needs at least one route.
3. `npm install` in the new folder to create `package-lock.json`.
**Verify**
- `cd mobile/CarabaoMerchantMobile; npx tsc --noEmit; npm run lint`
- `npm test` may report "no test files" here - fine until S2 adds the copies.
- `npx expo start` shows the placeholder screen.
**Done when:** the new app type-checks, lints and boots; the buyer app is untouched.
**Commit:** none

---

### S2 - Shared copies + guard test (plan §2.3, §4.6)

**Depends on:** S1.
**Do** (copy; keep the buyer copy as is; first line of every copy is
`// Shared with mobile/CarabaoMobile/<same path>. Keep both copies the same (sharedCopies.test.ts).`)
- `src/lib/`: `apiErrors.ts`+test, `baseUrl.ts`+test, `config.ts`, `idle.ts`+test,
  `imageUri.ts`+test, `inputLimits.ts`+test, `livePolling.ts`+test, `polling.ts`+test,
  `usePolling.ts`, `sessionEvents.ts`, `theme.ts`, `orderStatus.ts`+test,
  `passwordPolicy.ts`+test, `phone.ts`+test, `notificationList.ts`+test,
  `notificationPrefs.ts`+test, `webPages.ts`+test, `logGuard.test.ts`.
- `src/components/`: `UI.tsx`, `Skeleton.tsx`, `PasswordResetSheet.tsx`,
  `PhoneVerifySheet.tsx`, `AddEmailSheet.tsx`.
- `hooks/`: both `use-color-scheme*.ts` files.
- **Not** here: `api.ts`, `authClient.ts`, `AuthContext.tsx`, `AuthScreen.tsx`,
  `reviews.ts`, `inStep.test.ts`, `farms.ts` (S3/S6/S7/S11).
- New `src/lib/sharedCopies.test.ts`: for each file above read both apps
  (`../../../CarabaoMobile/<path>` relative to `src/lib`, e.g.
  `../../../CarabaoMobile/src/lib/apiErrors.ts`), drop the merchant copy's first line, assert
  equality; skip with a message if the buyer folder is missing (plan §4.6).
- `apiErrors.ts` / `baseUrl.ts` start with a CF comment in the buyer app - the marker becomes
  line 1 and the CF comment line 2. Do not renumber any `CF-xxxx`.
**Verify**
- `cd mobile/CarabaoMerchantMobile; npx tsc --noEmit; npm run lint; npm test`
  (`sharedCopies`, `logGuard` and every copied `*.test.ts` pass; `logGuard` needs >20 files,
  which the copies satisfy).
- `cd mobile/CarabaoMobile; npx tsc --noEmit; npm run lint; npm test` (unchanged, still green).
**Done when:** both apps are green and `sharedCopies.test.ts` fails if a copy drifts.
**Commit:** `feat(mobile-merchant): copy shared libs and components + drift guard`

---

### S3 - Auth, merchant API core, web origins (plan §4.1 authClient, §5 phase 2, §6)

**Depends on:** S2.
**Do**
1. Merchant `src/lib/api.ts` **core only**: lines 17-107 of the buyer file (`export { API_BASE,
   WEB_BASE } from './config'`, `REQUEST_TIMEOUT_MS`, `ApiError`, `request`, `send`) plus the
   imports they need - `getAccessToken` (`./authClient`), `emitSessionExpired`/`sessionGone`
   (`./sessionEvents`), `parseErrorBody` (`./apiErrors`), `API_BASE` (`./config`). Then
   `ApiUserProfile` (keep `merchant`; cart/addresses optional) and `api.users = { me }`. New
   file in the merchant app only.
2. Merchant `src/lib/authClient.ts`: copy, `APP_SCHEME = 'carabaomerchant'`,
   `storagePrefix: 'carabao-merchant'`. Not in the same-file check.
3. Merchant `src/lib/AuthContext.tsx`: copy; remove buyer-only bits if any show up (there is
   no cart/saved usage today, so normally unchanged apart from imports).
4. Merchant `src/screens/AuthScreen.tsx`: copy; title/subtitle say "Carabao Merchant"; keep
   the existing two-factor and "web only" messages.
5. Merchant `app/auth.tsx`: 1-line re-export, `headerShown: false`.
6. Web, plan §6:
   - `frontend/carabao-app/lib/auth.ts:102`: `const MOBILE_APP_SCHEMES = ["carabaomobile", "carabaomerchant"];`
     and build `mobileOrigins` from the array exactly as the plan shows.
   - `frontend/carabao-app/lib/admin-two-factor.ts:88`:
     `const MOBILE_ORIGIN_PREFIXES = ["carabaomobile://", "carabaomerchant://", "exp://"];`
     update its test if it lists prefixes.
**Verify**
- Merchant: tsc, lint, test. Buyer: tsc, lint, test (no changes expected).
- Web: `cd frontend/carabao-app; npm test`.
- Manual (local web server running): sign-in from the merchant app reaches Better Auth with
  no "invalid origin" error; an admin account is refused with `ADMIN_WEB_ONLY`.
**Done when:** the merchant app signs in, and the admin refusal still holds.
**Commit:** `feat(mobile-merchant): auth client, auth screen, merchant origin on web`

---

### S4 - Root gate (plan §4.3)

**Depends on:** S3.
**Do**
1. `git mv mobile/CarabaoMobile/src/lib/access.ts mobile/CarabaoMerchantMobile/src/lib/access.ts`
   and the same for `access.test.ts`; keep the CF-0120 comment and the `'admin'` branch
   (plan §4.3: "keep it as is").
2. **Buyer** `src/components/ProtectedScreen.tsx` must stop importing `../lib/access` in the
   same commit (plan §3.2): drop the `api.users.me` call, `decideAccess`, `MerchantCheck`;
   it only sends signed-out users to `/auth`. Keep accepting `requiredRole?: RequiredRole` and
   ignore it (a `// CF-0120: role enforcement moved to the merchant app` comment) so the five
   buyer screens that pass `requiredRole="merchant"` (`Listings`, `MerchantDashboard`,
   `MerchantOrders`, `MerchantChats`, `MerchantReviews`) still type-check until S8-S10 delete
   them. `access.test.ts` leaves with `access.ts`, so the buyer test count drops.
3. Merchant `src/lib/MerchantContext.tsx` (or `useMerchantGate`): when signed in call
   `api.users.me` once per user, expose `{ status: 'wait' | 'signin' | 'allowed' |
   'forbidden' | 'error', profile, retry }` via `decideAccess(..., 'merchant', check)`.
   No merchant screen mounts (and no `/merchants/me/*` call is made) before `allowed`.
4. Merchant `app/_layout.tsx`: `GestureHandlerRootView` -> `SafeAreaProvider` ->
   `AuthProvider` -> `ThemeProvider` -> gate -> `Stack`; no `CartProvider`/`SavedProvider`.
   Redirects: `signin` -> `/auth`, `forbidden` -> `/not-merchant`, `error` -> full-screen
   "Could not check your account" + "Try again" (the old `ProtectedScreen` text).
5. Merchant `app/not-merchant.tsx`: "This app is for farm accounts", "Apply to sell" ->
   `/onboarding`, "Sign out".
**Verify**
- Merchant: tsc, lint, test. Buyer: tsc, lint, test - `access.ts` left the buyer app, so
  confirm nothing else imported it:
  `Select-String -Path src\**\*.ts,src\**\*.tsx,app\**\*.tsx -Pattern decideAccess` (no hits)
- Manual: signed out -> `/auth`; merchant -> placeholder; buyer -> `/not-merchant`; admin
  refused; dev network log shows no `/merchants/me/*` before `allowed`.
**Done when:** every gate case behaves like the old `ProtectedScreen`, with its wording, and
the buyer app builds without `access.ts`.
**Commit:** none

---

### S5 - Tabs shell + More tab (plan §4.2, §4.4)

**Depends on:** S4. **Decision D1 first.**
**Do**
1. `app/(tabs)/_layout.tsx`: Home, Orders, Chats, Produce, More (default `Tabs` +
   `Ionicons`, or the merchant tab bar from D1). Temporary placeholders:
   `(tabs)/index.tsx`, `orders.tsx`, `chats.tsx`, `produce.tsx`, `more.tsx`.
2. `src/screens/MoreScreen.tsx` (new, small) rendered by `(tabs)/more.tsx`: farm name at the
   top (`verificationBanner` from `dashboard.ts` is added in S8, when that file arrives), rows:
   Reviews -> `/reviews`, Notifications -> `/notifications`, "Open buyer app"
   (`carabaomobile://`, web fallback `WEB_BASE`), "Merchant Centre on the web"
   (`${WEB_BASE}/merchantDashboard`), Sign out.
3. Placeholder routes `app/reviews.tsx`, `app/notifications.tsx`, `app/order-chat.tsx`,
   `app/onboarding.tsx` so the More rows and deep links resolve.
**Verify:** merchant tsc, lint, test; manual: 5 tabs render, every More row opens something,
sign out returns to `/auth`, a buyer account is still stopped by the gate.
**Done when:** the shell is navigable; placeholders exist only for screens owned by S8-S12.
**Commit:** none

---

### S6 - Pure modules the merchant screens need (plan §2.4 farms/orderDetail/reviews)

**Depends on:** S2 (the merchant app has no `reviews.ts`, `orderDetail.ts`, `farms.ts`).
**Do** (additive in the merchant app; buyer untouched in this section)
1. `src/lib/format.ts` + `format.test.ts`: `ratingLabel` copied from buyer `src/lib/farms.ts`
   (lines 22-25), same CF-0111 header. Replaces `ratingLabel` for the merchant dashboard.
2. `src/lib/orderChat.ts` + `orderChat.test.ts`: only `chatTitle` and `parseOrderId` from
   buyer `src/lib/orderDetail.ts` (lines 32-51), with their comments and CF refs.
3. `src/lib/myReviews.ts` + `myReviews.test.ts`: the merchant half of buyer `reviews.ts`
   (decision D2):
   - display helpers both screens use: `stars`, `reviewSummary`, `mergeReviews`, `wasEdited`,
     `shownReply`, and `PublicReview` (the type they operate on);
   - merchant-only: `MyReview`, `MyMerchantReviews`, `MyReviewsFilter`, `MY_REVIEWS_PAGE`,
     `myReviewsQuery`, `breakdownRows`, `toggleRating`, `replaceReview`;
   - reply rules: `REPLY_MAX_LENGTH`, `replyProblem`.
   Keep CF-0112/CF-0119/CF-0133 comments and the "keep REPLY_MAX_LENGTH in step" sentence.
   Do **not** copy `farmReplyLabel` (buyer farm page only).
4. `src/lib/inStep.test.ts`: copy the buyer file (header and repo-root math unchanged), then
   keep only these tests: order statuses, order status labels, password policy, phone pattern,
   and CF-0133 with its dynamic import changed to `./myReviews.ts`. Drop the
   `orderHistory`/`orderDetail` (CF-0128 x2), `checkoutOptions` and `vouchers` (CF-0131) tests
   with their imports.
**Verify**
- Merchant: `npx tsc --noEmit; npm run lint; npm test` (new tests + `inStep` pass; it reads
  `backend/` and `frontend/` from the same repo root).
- Buyer: tsc, lint, test unchanged.
**Done when:** `myReviews`, `format`, `orderChat` and the merchant `inStep` are green.
**Commit:** none

---

### S7 - Merchant API surface (plan §2.4 api.ts)

**Depends on:** S3 (api core), S6 (`myReviews` types).
**Do** (merchant `src/lib/api.ts`; buyer `api.ts` untouched until S14)
- Types: `ApiMerchant`/`ApiProduce` as the moved screens need (`ApiProduce` keeps
  `hidden_at`/`hidden_reason`), `ProduceCategory`, `ProduceUnit`, `ProduceCreatePayload`,
  `ProduceUpdatePayload`, `MerchantOrderStatus`, `ApiMerchantOrder`, `ApiStockAlertItem`,
  `ApiStockAlerts`, `ApiNotification`, `ApiChatMessage`, `ApiChatThread`; import
  `MyMerchantReviews`/`MyReview` from `./myReviews`.
- `api.merchants`: `myProduce`, `myOrders`, `myReviews`, `setReviewReply`, `deleteReviewReply`,
  `stockAlerts`, `updateOrderStatus`, `cancelOrder` (copy buyer lines 515-519, 525-546 verbatim,
  CF-0119/CF-0133 comments included).
  `chats`/`performance`/`demand` (buyer 521-524) are **deferred to S8**: they need
  `ChatSummary`, `MerchantPerformance` and `DemandInsight`, which arrive with
  `chatInbox.ts`/`dashboard.ts` in that section.
- `api.produce`: `create`, `update`, `remove` (buyer lines 593-607, CF-0116).
- Keep `api.users.me`; add `api.chat.*` (`thread`, `send`, buyer lines 656-663) and the whole
  buyer `api.notifications` group (`unreadCount`, `markRead`, `markAllRead`, `page`,
  `markUnread`, `remove`, `removeRead`, lines 665-683, CF-0117/CF-0121 comments) with
  `ApiNotification` and the `UNREAD_COUNT_QUERY` import from `./polling` (S2).
- Per decision D3, add no buyer-only groups (cart, addresses, orders, payments, tracking,
  saved, follows, search, reorder, support, referencePrices).
**Verify:** merchant tsc, lint, test. Buyer green.
**Done when:** every method the moved screens call exists with the buyer's signatures.
**Commit:** none

---

### S8 - Move dashboard, orders, chats (plan §2.1, §4.2, §3.1)

**Depends on:** S5, S6 (`format.ts`), S7.
**Do**
1. `git mv` into `mobile/CarabaoMerchantMobile/`:
   - `src/screens/MerchantDashboardScreen.tsx`, `MerchantOrdersScreen.tsx`,
     `MerchantChatsScreen.tsx`
   - `src/components/CancelOrderSheet.tsx`
   - `src/lib/dashboard.ts` + `dashboard.test.ts`, `src/lib/chatInbox.ts` + `chatInbox.test.ts`
2. Delete the buyer route files `app/merchant-dashboard.tsx`, `app/merchant-orders.tsx`,
   `app/merchant-chats.tsx` (`git rm`) **and** their `<Stack.Screen>` lines in
   `app/_layout.tsx` (lines 34, 43, 44) in the same commit - otherwise buyer tsc/typedRoutes
   fails.
3. In the moved screens: drop the `ProtectedScreen` wrapper (the root gate owns it) and keep
   the content component; rename route targets -
   `'/merchant-orders'` -> `'/(tabs)/orders'`, `'/merchant-chats'` -> `'/(tabs)/chats'`,
   `'/listings'` -> `'/(tabs)/produce'`, `'/merchant-reviews'` -> `'/reviews'`
   (`MerchantDashboardScreen` lines 107-110); `/order-chat` stays.
4. Replace the placeholder tab files `(tabs)/index.tsx`, `(tabs)/orders.tsx`,
   `(tabs)/chats.tsx` with 1-line re-exports of the moved screens.
5. `MerchantDashboardScreen.tsx` imports `ratingLabel` from `../lib/farms`; repoint it at
   `../lib/format` (S6). `dashboard.ts` itself is import-free and moves unchanged.
6. Merchant `src/lib/api.ts`: add `api.merchants.chats` (CF-0127), `performance` and `demand`
   (CF-0125) - buyer lines 521-524 - and import `ChatSummary` from `./chatInbox`,
   `MerchantPerformance`/`DemandInsight` from `./dashboard` (both arrived in step 1).
7. Buyer handoff, in the same commit (the routes it names are now gone) - plan §3.3, §3.5:
   - new `src/lib/merchantHandoff.ts` + `merchantHandoff.test.ts`: `MERCHANT_APP_URL =
     'carabaomerchant://'`, `merchantWebUrl(webBase, kind)` (`/merchantDashboard` |
     `/merchantOnboarding`), `merchantAppPath(kind, notificationKind?)` exactly as plan §3.3.
   - new `src/lib/openMerchant.ts` (not pure, no test): `Linking.canOpenURL(MERCHANT_APP_URL +
     path)` -> open, else `WebBrowser.openBrowserAsync(merchantWebUrl(...))`.
   - buyer `src/lib/notificationLinks.ts`: every `/merchantDashboard...` branch (including
     `chat_message` with `?order=`) returns `{ merchant: kind }`; `AppRoute` gains that member
     and keeps `/(tabs)/track`, `/(tabs)/history`, `/order-detail`, `/order-chat`. Update
     `notificationLinks.test.ts` the same way (CF-0105/CF-0121 comments stay).
   - buyer `src/screens/NotificationsScreen.tsx`: a `{ merchant: kind }` result calls
     `openMerchant('dashboard', kind)`. Merchant notifications stay in the buyer list.
   - buyer `app.json`: `ios.infoPlist.LSApplicationQueriesSchemes: ["carabaomerchant"]`, and
     the Android `<queries>` entry per Expo SDK 58 (if unavailable, `canOpenURL` returns
     false on Android 11+ and the web fallback runs - acceptable, note it in the README).
8. Buyer `src/screens/ProfileScreen.tsx` (plan §3.4): replace the merchant block (the five
   `router.push('/merchant-*' | '/listings')` rows, ~lines 130-185) with the single banner -
   merchant: farm name + "Manage your farm in Carabao Merchant" -> `openMerchant('dashboard')`;
   otherwise "Sell on Carabao" + "Set up your farm in the Carabao Merchant app" ->
   `openMerchant('onboarding')`. Remove the styles that are no longer used. This must be in
   this commit: those routes stop existing below.
**Verify**
- Merchant: tsc, lint, test.
- Buyer: tsc, lint, test - nothing left:
  `Select-String -Path src\**\*.ts,src\**\*.tsx,app\**\*.tsx -Pattern 'merchant-(dashboard|orders|chats)'`
- Manual: orders list + status change + cancel-with-reason, chat inbox opens, dashboard tiles;
  in the buyer app a merchant notification now hands off to the merchant app (or the web page
  when it is not installed).
**Done when:** the three screens run in the merchant app, the buyer app no longer references
them, and its merchant notifications hand off instead of opening a dead route.
**Commit:** none

---

### S9 - Move listings and onboarding (plan §2.1, §4.2)

**Depends on:** S8 (route names `/(tabs)/produce` are already used by the dashboard links).
**Do**
1. `git mv`: `src/screens/ListingsScreen.tsx`, `src/screens/OnboardingScreen.tsx`,
   `src/components/ListingForm.tsx`, `src/lib/listingForm.ts` + `listingForm.test.ts`.
2. `git rm` buyer `app/listings.tsx`, `app/onboarding.tsx` **and** their `<Stack.Screen>`
   lines (`app/_layout.tsx` 32, 33 before S8's deletions - re-locate by route name).
3. `(tabs)/produce.tsx` re-exports the produce screen (`ListingsScreen` when moved; renamed
   `ProduceScreen` in S13); merchant `app/onboarding.tsx` re-exports
   `OnboardingScreen` (it still opens the web form via `WEB_BASE`); the gate's
   "Apply to sell" already points at `/onboarding`.
4. Drop `ProtectedScreen` from both screens; keep every `Alert`/validation text unchanged.
**Verify**
- Merchant: tsc, lint, test; Buyer: tsc, lint, test -
  buyer grep for `'/listings'|'/onboarding'` returns nothing.
- Manual: create/edit/delete a listing, stock alerts show, onboarding intro opens the web form.
**Done when:** produce management works in the merchant app; the buyer has no listings route.
**Commit:** none

---

### S10 - Move the reviews screen (plan §2.1, §2.4 reviews.ts)

**Depends on:** S6 (`myReviews.ts`), S7 (`api.merchants.myReviews`/reply methods).
**Do**
1. `git mv` `src/screens/MerchantReviewsScreen.tsx` to the merchant app.
2. `git rm` buyer `app/merchant-reviews.tsx` and its `<Stack.Screen>` line
   (`app/_layout.tsx` 42 before S8's deletions - re-locate by route name).
3. `app/reviews.tsx` (merchant) re-exports the screen; the dashboard link and the More row
   point at `/reviews` (S5/S8 already do).
4. Change the screen's import block from `'../lib/reviews'` to `'../lib/myReviews'`; the
   names it uses (`breakdownRows`, `mergeReviews`, `MY_REVIEWS_PAGE`, `myReviewsQuery`,
   `replaceReview`, `REPLY_MAX_LENGTH`, `replyProblem`, `reviewSummary`, `shownReply`,
   `stars`, `toggleRating`, `wasEdited`, `MyMerchantReviews`, `MyReview`, `MyReviewsFilter`)
   must all come from there. Drop `ProtectedScreen`.
**Verify**
- Merchant: tsc, lint, test; Buyer: tsc, lint, test.
- Manual: summary + breakdown, star/comment filters, paging, write/edit/delete a reply
  (404 on an admin-hidden review still shows the error).
**Done when:** the reviews screen works with `myReviews.ts` and the buyer app is clean.
**Commit:** none

---

### S11 - Order chat in the merchant app (plan §2.3 OrderChatScreen, §4.2)

**Depends on:** S6 (`orderChat.ts`), S7 (`api.chat`), S8 (orders/chats open it).
**Do**
1. **Copy** (not move) `src/screens/OrderChatScreen.tsx` into the merchant app; the buyer
   keeps its own copy. First line of the merchant copy:
   `// Merchant copy of mobile/CarabaoMobile/src/screens/OrderChatScreen.tsx - keep behaviour the same.`
2. Point its imports at `../lib/orderChat` (`chatTitle`, `parseOrderId`) instead of
   `orderDetail`; everything else (`usePolling`, `shouldPollChat`, `CHAT_BODY_MAX`,
   `PhoneVerifySheet`, `isPhoneVerificationRequired`, `api.chat`) already exists from S2/S7.
3. Keep the support-chat branch (`support=1` -> `/support/messages`) - the endpoint is shared.
   Drop `ProtectedScreen`; the gate covers the screen.
4. `app/order-chat.tsx` (merchant) re-exports it, `headerShown: false`.
**Verify**
- Merchant: tsc, lint, test; Buyer: tsc, lint, test.
- Manual: open a chat from Orders and from Chats, send a message, reopen after backgrounding
  (polling resumes), unverified phone shows the verify sheet.
**Done when:** both apps open their own order-chat screens against the same endpoints.
**Commit:** none

---

### S12 - Notifications (plan §4.2, §4.5)

**Depends on:** S11 (`/order-chat` exists in the merchant app), S7 (`api.notifications`).
**Do**
1. **Copy** `src/screens/NotificationsScreen.tsx` into the merchant app (buyer keeps its own);
   first line marks it as the merchant copy. Create merchant `app/notifications.tsx`
   re-exporting it (the buyer's `app/notifications.tsx` renders its own copy).
2. Merchant `src/lib/notificationLinks.ts` + `notificationLinks.test.ts`: copy, then
   - `AppRoute` = `{ pathname: '/(tabs)' | '/(tabs)/orders' | '/(tabs)/chats' | '/reviews' } |
     { pathname: '/order-chat'; params: { orderId: string } }` (no `/track`, no
     `/order-detail`, since the merchant has neither);
   - map by kind exactly as plan §4.5 / the web bell do: `new_order` -> `/(tabs)/orders`,
     `chat_message` -> the chat for `?order=<id>` else `/(tabs)/chats`, `review_received` ->
     `/reviews`, `payout_released` / `payout_destination_changed` -> `/(tabs)` (Earnings is
     Plan 2), anything else -> `/(tabs)`;
   - `/track` and `/orders*` are buyer links here: return `null`.
   Keep the CF-0105/CF-0121 comments and the bad-id cases in the test.
3. The merchant list shows only merchant notifications; write the filter as a pure function
   (`isMerchantNotification(link)` = link starts with `/merchantDashboard`, plan §4.5) in
   `notificationLinks.ts` with its own test cases, and use it in the copied screen.
4. Mark-read on open as today, through `api.notifications`.
5. Deep links must land after the gate: `carabaomerchant://orders`, `.../reviews`,
   `.../chats?order=12`, `.../onboarding` (expo-router maps the scheme; only the route
   existence and the gate are new).
6. Buyer unchanged here (its `notificationLinks.ts` handed off in S8).
**Verify**
- Merchant: tsc, lint, test; Buyer: tsc, lint, test.
- Manual: `new_order`, `review_received`, `chat_message` and a payout notification each open
  the right merchant screen; a buyer link opens nothing; each deep link above lands correctly
  once signed in as a merchant.
**Done when:** merchant notifications route only to merchant screens and both the mapping and
the filter are covered by tests.
**Commit:** none

---

### S13 - Merchant acceptance pass (plan §4.7, §5 phase 4 gate)

**Depends on:** S1-S12.
**Do** (no new features; fix what the pass finds)
1. `Select-String -Path app\**\*.tsx,src\**\*.ts,src\**\*.tsx -Pattern 'ProtectedScreen|CartProvider|SavedProvider|carabaomobile'`
   in `mobile/CarabaoMerchantMobile` - expected hits only: the "Open buyer app" link and the
   shared-copy markers.
2. `Select-String -Path app\**\*.tsx -Pattern 'merchant-(dashboard|orders|chats|reviews)|/listings'`
   - expected: none (tab routes and `/reviews` replaced them).
3. Merchant test count vs the S2/S6 baseline; buyer test count vs the S0 baseline; web
   `npm test`.
4. Manual matrix: sign out/in; buyer account -> `/not-merchant`; admin -> web-only message;
   dashboard/orders/chats/produce/reviews/notifications/order-chat; idle timeout; password
   reset + phone verify sheets; deep link `carabaomerchant://order-chat?orderId=1`.
**Verify:** the three checks are clean and the matrix passes on a device/simulator.
**Done when:** the merchant app is feature-complete against plan §3.5 and nothing buyer-only
is left in it.
**Commit:** none

---

### S14 - Strip the buyer app (plan §3.1-§3.6, §5 phase 3 leftovers)

**Depends on:** S8-S13 (nothing may be removed while the buyer still uses it).
**Do**
1. Buyer `src/lib/api.ts` (plan §3.6): delete the merchant-owner methods (`myProduce`,
   `myOrders`, `chats`, `performance`, `demand`, `myReviews`, `setReviewReply`,
   `deleteReviewReply`, `stockAlerts`, `updateOrderStatus`, `cancelOrder` - lines 515-546) and
   `api.produce` in full (lines 593-607), plus the types only they use: `MerchantOrderStatus`,
   `ApiMerchantOrder`, `ApiStockAlertItem`, `ApiStockAlerts`, `ProduceCreatePayload`,
   `ProduceUpdatePayload`, and the imports on lines 10-12 (`./reviews` My* types,
   `./dashboard`, `./chatInbox`). **Keep** `ApiMerchant`, `ApiProduce`,
   `api.merchants.list/get/produce` (public farm page) and produce search - the buyer still
   browses farms. Let `tsc` find leftovers.
2. Buyer `src/lib/reviews.ts`: delete `MyReview`, `MyMerchantReviews`, `MyReviewsFilter`,
   `myReviewsQuery`, `MY_REVIEWS_PAGE`, `breakdownRows`, `replaceReview`, `replyProblem`,
   `REPLY_MAX_LENGTH`, `toggleRating` (they live in the merchant `myReviews.ts` now) and their
   tests in `src/lib/reviews.test.ts`. Keep `stars`, `reviewSummary`, `mergeReviews`,
   `hasMoreReviews`, `wasEdited`, `shownReply`, `farmReplyLabel`, `PublicReview`,
   `MerchantReviews`, `REVIEWS_FIRST_PAGE`, `REVIEWS_MORE_PAGE` so `FarmReviews.tsx` still
   compiles.
3. Buyer `src/components/ProtectedScreen.tsx`: with the merchant routes gone, delete the
   ignored `requiredRole` prop and its branches; it is a sign-in wrapper only (plan §3.2).
4. Buyer `src/lib/inStep.test.ts`: drop the CF-0133 `REPLY_MAX_LENGTH` test (the constant is
   gone here); the merchant copy keeps it.
5. Delete any buyer screen/component left unused; `src/lib/farms.ts` keeps `ratingLabel`
   (the buyer farm page uses it).
6. Buyer `src/screens/ProfileScreen.tsx` merchant banner was already replaced in S8 (plan
   §3.4). It still reads `profile.merchant.merchant_name`, so `ApiUserProfile.merchant` stays;
   here only confirm no dead style or unused helper is left behind.
7. Re-run the plan §3.2/§3.3 greps in the buyer app: no `merchant`, `produce`, `stock`
   references outside profile/admin copy.
**Verify:** buyer tsc, lint, test; merchant tsc, lint, test; web `npm test`.
**Done when:** the buyer app carries no merchant code path and stays green.
**Commit:** none

---

### S15 - Buyer acceptance pass (plan §3.7) + shared-copy refresh

**Depends on:** S14.
**Do** (no new features)
1. Plan §3.7 grep in `mobile/CarabaoMobile`:
   `Select-String -Path src\**\*.ts,src\**\*.tsx,app\**\*.tsx -Pattern "merchant-(orders|dashboard|chats|reviews)|/listings'|/onboarding'|merchants/me|requiredRole"`
   -> no results (the `merchantHandoff`/`openMerchant` helpers and the profile banner are the
   only allowed mentions of the scheme).
2. `tsc`, `lint`, `npm test` in the buyer app; `npm test` in the merchant app and the web app.
3. Confirm `mobile/CarabaoMerchantMobile/src/lib/sharedCopies.test.ts` lists only files that
   still exist in both apps after S14, and that it fails if a copy is edited (try one, revert).
4. Manual: browse a farm (`/merchant?id=`), place/preview an order, chat with the farm, read
   notifications (merchant ones hand off), profile shows the single merchant banner that opens
   the merchant app when installed and the web page when it is not.
**Verify:** the grep is empty, all three suites pass, the manual pass is done.
**Done when:** the buyer app has no merchant code path and every buyer flow still works.
**Commit:** none

---

### S16 - Docs and reference updates (plan §5 phase 5, §8)

**Depends on:** S15.
**Do**
1. `documentation/SYSTEM_REFERENCE.md`: §4.3 env vars for both apps; §5 commands
   (`cd mobile/CarabaoMerchantMobile; npm test`); the app table (buyer vs merchant, scheme,
   who may sign in).
2. `documentation/manuals/MOBILE_MERCHANT_SPLIT_PLAN.md`: add a "Status" line per phase
   pointing at the sections that implemented it, and correct the plan text where §2 of this
   doc disagreed (ProtectedScreen in S4/S14, profile banner in S8, `api.produce.*` out in S14).
3. `documentation/SUBDOMAINS.md` 1.2 / the merchant-centre doc: note that merchant screens now
   live in `mobile/CarabaoMerchantMobile` and the web merchant shell stays as-is
   (plan §5 phase 5).
4. This file: tick S1-S16 with the commit hashes
   (`git log --oneline -- mobile/CarabaoMerchantMobile`).
5. `mobile/CarabaoMobile/README.md` and the merchant README: cross-link the two apps, list the
   `carabaomobile://` / `carabaomerchant://` schemes and the web fallbacks.
6. `CHANGELOG.md` if the repo keeps one: one line per app change.
**Verify:** markdown links resolve; every command quoted in the docs runs as written.
**Done when:** a new contributor can find, run and test both apps from the docs alone.
**Commit:** `docs: merchant app split`

---

## 6. Traceability

| Plan item | Section |
| --- | --- |
| §2.1 screens: dashboard/orders/chats | S8 |
| §2.1 screens: listings/onboarding | S9 |
| §2.1 screens: reviews | S10 |
| §2.1 screens: order chat | S11 |
| §2.1 screens: notifications | S12 |
| §2.2 components: CancelOrderSheet, ListingForm | S8, S9 |
| §2.2 components: sheets, UI, Skeleton | S2 |
| §2.3 api.ts split | S3, S7, S14 |
| §2.3 access.ts | S4 |
| §2.3 inStep.test.ts | S6, S14 |
| §2.3 orderDetail.ts | S6, S11 |
| §2.3 notificationLinks.ts | S8, S12 |
| §2.3 OrderChatScreen copy | S11 |
| §2.4 reviews.ts split | S6, S10, S14 |
| §2.4 dashboard.ts / chatInbox.ts / listingForm.ts | S8, S9 |
| §2.4 shared date helpers (`dates.ts`, split out of `listingForm.ts`) | S9 |
| §2.4 farms.ts ratingLabel | S6 |
| §3.1 merchant routes removed from the buyer | S8-S10 |
| §3.2 ProtectedScreen sign-in only | S4, S14 |
| §3.3 handoff helpers (`merchantHandoff.ts`, `openMerchant.ts`, app.json queries) | S8 |
| §3.4 profile banner | S8 |
| §3.5 buyer notification hand-off | S8 |
| §3.6 merchant api/types out of the buyer | S14 |
| §3.7 buyer acceptance | S15 |
| §4.1 scaffold + config | S1, S3 |
| §4.2 tabs + More | S5, S8-S12 |
| §4.3 role gate | S4 |
| §4.4 More rows | S5 |
| §4.5 notifications + deep links | S12 |
| §4.6 shared-copy guard | S2, S15 |
| §4.7 merchant acceptance | S13 |
| §5 phases 1-5 | S1-S16 |
| §6 web origins | S3 |
