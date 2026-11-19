# Mobile Improvement Log
branch: improve/mobile-loop    push: no    iteration: 3    target: 20

Worktree: this loop runs in its own git worktree (not the main checkout, not the web loop's
`improve/loop` worktree). `node_modules` is installed per worktree (`npm ci`).
CF IDs: the web loop runs at the same time and takes the next CF number, so this loop
takes IDs from **CF-0101 upward** (last used: CF-0102) to avoid collisions.

## In progress
(none)

## Kind balance (count / last iteration #)
PARITY 1/#3 · STRENGTHEN 1/#2 · SECURITY 0/- · AUDIT 1/#1

## Needs human
- `npm audit --omit=dev`: 3 moderate (minimatch ReDoS via `@expo/fingerprint` ← `expo`). The only
  "fix" npm offers is a downgrade to expo@52 (breaking). Wait for an Expo 58 patch that bumps
  `@expo/fingerprint`; do not force it in a loop iteration. Build-time tool, not in the app bundle.
- Web log `IMPROVEMENT_LOG.md` B34: the history half is done on mobile (#3, CF-0102); the saved-produce
  half is M06 here. Not edited from this branch because the web loop edits that file at the same time
  (merge conflict risk). When the two branches are merged, mark B34 "moved to mobile log M04/M06".

## Parity matrix (refreshed on AUDIT, row updated on each PARITY)
| web page / feature | mobile screen | status | backend routes | notes |
|--------------------|---------------|--------|----------------|-------|
| `farms` farm list (+ follow) | `(tabs)/index` → `OrderScreen` | done | `/merchants`, `/users/me/follows`, `/merchants/:id/follow` | farm type still imported from `mockData.ts` (M02) |
| `farms/[merchantID]` farm detail | `merchant` → `MerchantScreen` | partial | `/merchants/:id`, `/merchants/:id/produce` ✓; `/merchants/:id/reviews`, `/merchants/:id/shoppage` not called | no reviews list, no published shop page (banner/logo/about) |
| `order` produce search | `OrderScreen` search | partial | `/produce/search` ✓ (only `q`, `in_stock`, `page_size`) | no category/price filters, no sort, no paging |
| `saved` saved produce | — | missing | `/users/me/saved-produce`, `/users/me/saved-produce/ids`, `/produce/:id/save` exist | was web B34/B38 |
| `cart` | `(tabs)/cart` → `CartScreen` | done | `/carts/me` | |
| `checkout` | `checkout` → `CheckoutScreen` | partial | `/orders/me/place`, `/payments/checkout/:id` ✓; `/users/me/addresses`, `/payments/checkout/:id/cancel` not called | no address book / default address, no cancel of pending payment |
| `confirmation`, `orders/success` | `confirmation` → `ConfirmationScreen` | done | `/payments/transactions/order/:id` | checks status with server |
| `orders` history | `(tabs)/history` → `HistoryScreen` | done | `/orders/me/history/page` ✓ (since #3) | status filter, search, infinite scroll; unpaged route now unused by mobile (M30) |
| `orders/[orderId]` order detail | — | missing | `/orders/me/:id`, `/orders/me/:id/cancel`, `/orders/me/:id/confirm-received`, `/orders/me/:id/review` exist | reorder exists from history only |
| `track` | `(tabs)/track` → `TrackScreen` | partial | `/tracking/:id` ✓; `/shipments/:id` not called | |
| `notifications` | `notifications` → `NotificationsScreen` | partial | list, read, read-all ✓; delete, unread, bulk read not called | |
| `profile` account | `(tabs)/profile` → `ProfileScreen` | partial | `/users/me` ✓; `/users/me/addresses`, `/users/me/avatar`, `/users/me/delete-code`, `/email/otp/*` not called | no address book, avatar, account deletion |
| order chat | `order-chat` → `OrderChatScreen` | done | `/orders/:id/messages`, `/support/messages` | |
| `auth`, `forgot-password`, `reset-password` | `auth` → `AuthScreen` + `PasswordResetSheet`, `PhoneVerifySheet`, `AddEmailSheet` | done | Better Auth | |
| `two-factor`, `two-factor/enrol` | — | n/a — web-only | | verify on next AUDIT whether non-admin users can enrol 2FA |
| `email-verified`, `landing` | — | n/a — web-only | | |
| merchant `auth` | `AuthScreen` (shared) | done | Better Auth | |
| merchant `onboarding` | `onboarding` → `OnboardingScreen` | partial | opens web `/merchantOnboarding` in browser; `/merchant-onboarding/me`, `/merchant-applications/me` not called | no native onboarding / application status |
| merchant dashboard | — | missing | `/merchants/me/performance`, `/merchants/me/demand` exist | |
| merchant `produce` | `listings` → `ListingsScreen` + `ListingForm` | partial | `/merchants/me/produce`, `/produce/`, `/produce/:id` ✓; `/produce/:id/image` not called | no photo upload |
| merchant `inventory` / stock alerts | `ListingsScreen` | partial | `/merchants/me/stock-alerts` ✓ | alerts shown inline, no inventory view |
| merchant `orders` | `merchant-orders` → `MerchantOrdersScreen` | done | `/merchants/me/orders`, `/merchants/me/orders/:id/status` | |
| merchant `shipments`, `routing/[shipmentId]` | — | missing | `/merchants/me/shipments`, `/shipments/:id` exist | |
| merchant `chats` | — | missing | `/merchants/me/chats` exists | per-order chat works, no inbox |
| merchant `reviews` + replies | — | missing | `/merchants/me/reviews` exists | |
| merchant `sales` | — | missing | `/merchants/me/sales`, `/merchants/me/transactions` exist | |
| merchant `earnings` / cash-out | — | missing | `/merchants/me/payouts*`, `/merchants/me/payout-info*`, `/merchants/me/payout-institutions` exist | payout destination lock rules apply |
| merchant `shop` page | — | missing | `/merchants/me/shoppage` (+ banner, logo, publish, discard) exist | |
| merchant `settings` | — | missing | `/merchants/me` exists | |

Parity score: 8 / 26 done (7 partial, 11 missing; 3 rows n/a)

## Backlog (highest impact÷effort first)
| id | kind | size | impact | effort | area | epic | item — acceptance test |
|----|------|------|--------|--------|------|------|------------------------|
| M29 | SECURITY | M | 4 | 2 | auth | — | `ProtectedScreen` accepts `requiredRole` but never checks it (its doc comment says it does). Nothing passes it today, so merchant screens rely on the server 404 → "not a merchant" state. Implement the role check from the server profile (`/users/me`), use it on merchant routes, test the pure decision in `src/lib/` — test: a buyer who opens `/listings` sees the not-allowed state with no merchant API call. |
| M02 | STRENGTHEN | M | 3 | 2 | tests | — | `npm test` exists since #3 (`node --test`, Node 24 strips TS types; test files need `/// <reference types="node" />` and `.ts` import paths). Add test files for `cartGroups`, `orderStatus`, `phone`, `passwordPolicy`, `referencePrices`, `idle` and register each in the script; compare values with web/backend while there — test: `npm test` runs ≥ 7 files. |
| M30 | STRENGTHEN | S | 2 | 1 | orders | — | Retire unpaged `GET /orders/me/history` (backend `orders.py:325`): mobile `api.orders.history` and web no longer use it after #3. Remove route + mobile wrapper + backend test, add a line to the web log — test: backend pytest passes, `grep` finds no caller. Batch with other backend S items or do with the web loop. |
| M03 | PARITY | M | 4 | 3 | orders | parity | Order detail screen `orders/[orderId]` (items, status, totals from server, cancel, confirm received) — test: open from history, cancel a pending order, see the new status. |
| M05 | PARITY | M | 4 | 3 | checkout | parity | Address book on checkout and profile (`/users/me/addresses`, default address) — test: add 2 addresses, set default, checkout uses default. |
| M06 | PARITY | M | 3 | 2 | discovery | parity | Saved produce: heart on produce rows + Saved screen (was web B38) — test: save item, it shows in Saved after restart. |
| M07 | PARITY | M | 3 | 2 | discovery | parity | Farm detail: reviews list + published shop page (banner, logo, about) — test: farm with reviews shows them with stars. |
| M08 | PARITY | M | 3 | 3 | orders | parity | Leave a review for a delivered order (`/orders/me/:id/review`) — test: delivered order shows "Review", submit, farm rating updates. |
| M09 | PARITY | M | 3 | 3 | discovery | parity | Produce search filters/sort/paging matching web `produceSearch.ts` — test: sort by price ascending, page 2 loads. |
| M10 | SECURITY | M | 4 | 2 | config | — | Fail closed on non-https `API_BASE`/`WEB_BASE` in production builds (`__DEV__` false); pure check in `src/lib/config.ts` with test — test: `http://` in prod throws/blocks. |
| M11 | SECURITY | M | 3 | 2 | auth | — | Verify a 401 that survives the token retry signs the user out and clears cart/user data; verify sign-out clears every AsyncStorage key with PII — test: unit test on the clear-keys list + manual check. |
| M12 | SECURITY | S | 3 | 1 | payments | — | Allow-list hosts before `WebBrowser.openBrowserAsync(checkout.checkout_url)` (PayMongo host only) — test: off-list URL refused. |
| M13 | STRENGTHEN | M | 3 | 2 | cleanup | — | Remove Expo starter files (`app/modal.tsx` + its Stack entry, `app/(tabs)/App.tsx` which is also a stray route, `hello-wave`, `parallax-scroll-view`, `external-link`, `collapsible`, themed-* if unused); merge `constants/theme.ts` into `src/lib/theme.ts` — test: lint + tsc pass, app boots. |
| M14 | STRENGTHEN | M | 2 | 1 | discovery | — | Farm card batch: move `Farm` type out of `mockData.ts` and delete it; replace hot-linked Unsplash placeholder with a local asset; show "New" not "⭐ 0" when a farm has no rating; hide "₱0 delivery" when fee unknown — test: farm with no reviews shows "New". |
| M15 | PARITY | M | 3 | 3 | merchant | parity | Merchant dashboard (performance + demand + stock alert counts) — test: merchant sees sales totals that match web dashboard. |
| M16 | PARITY | L | 4 | 4 | merchant | merchant-shipments | Merchant shipments list + shipment route view (`/merchants/me/shipments`, `/shipments/:id`) — slice 1: list; slice 2: map/stop order. |
| M17 | PARITY | M | 3 | 3 | merchant | parity | Listing photo upload via `/produce/:id/image` (expo-image-picker — check Expo Go support first) — test: new listing shows uploaded photo. |
| M18 | PARITY | M | 3 | 2 | merchant | parity | Merchant reviews + reply — test: reply shows under review on farm detail. |
| M19 | PARITY | L | 3 | 4 | merchant | merchant-earnings | Earnings and cash-out (payout info, available balance, request) honoring payout destination lock — slice per screen. |
| M20 | PARITY | M | 2 | 2 | merchant | parity | Merchant sales history (`/merchants/me/sales`, `/transactions`) — test: list matches web sales page. |
| M21 | PARITY | M | 2 | 3 | merchant | parity | Merchant shop page editor (details, banner, logo, publish/discard) — test: publish, buyer farm detail shows new banner. |
| M22 | PARITY | M | 2 | 2 | merchant | parity | Merchant chats inbox (`/merchants/me/chats`) → opens existing `OrderChatScreen` — test: inbox lists chats with unread first. |
| M23 | PARITY | M | 2 | 2 | account | parity | Account deletion (`/users/me/delete-code`) + avatar upload on profile — test: deletion flow signs out and clears local data. |
| M24 | PARITY | S | 2 | 1 | notifications | parity | Notifications: mark unread, delete (batch with other notification S items) — test: swipe delete removes row server-side. |
| M25 | PARITY | M | 2 | 2 | checkout | parity | Cancel a pending payment (`/payments/checkout/:id/cancel`) from confirmation — test: cancel returns order to cart/cancelled state like web. |
| M26 | STRENGTHEN | S | 2 | 1 | logs | — | `ConfirmationScreen` `console.warn` logs raw error objects (may hold URLs with order IDs); log only status/message, and only in `__DEV__` — test: grep shows no raw err logging. |
| M27 | STRENGTHEN | M | 2 | 2 | perf | — | Long lists on `ScrollView`+`map` → `FlatList` with memo rows (check Order, History, Listings, MerchantOrders) — test: lint + manual scroll of 50 rows. |
| M28 | PARITY | M | 2 | 3 | onboarding | parity | Native merchant application status (`/merchant-applications/me`) instead of only opening web — test: pending applicant sees "under review". |

## History (newest first; keep last 30, summarize older ones in one line each)
### #3 — PARITY — orders — CF-0102 — M
What: Order History uses `GET /orders/me/history/page` (M04, was web B34). Search box (order number or farm, 400 ms debounce, capped at 100 chars like the API), status chips (All / In progress / Delivered / Cancelled, same groups as web), infinite scroll (pages of 10, `onEndReached`), pull to refresh, "No matching orders" + "Clear filters" empty state, total count line. New `src/lib/orderHistory.ts`: copy of web `lib/order-history.ts` (marked to keep in step) + mobile-only `historyQueryString`, `mergeHistoryPage` (no duplicate rows when a new order shifts pages), `hasMoreHistory`. New `api.orders.historyPage`. First mobile test runner: `npm test` = `node --test` (Node 24 strips types); added `allowImportingTsExtensions` to tsconfig (as web) and `@types/node` ~26.6 as dev dependency (was already installed transitively; reference is in the test file only, so app code does not get Node globals). Removed: the summary banner "Delivered" and "Total spent" (cannot be computed from one page; no server total exists) — replaced by the count of orders for the current filter. Why: parity, and the unpaged route loaded every order. Tests: `src/lib/orderHistory.test.ts` 7 (web's 4 + query string encoding, merge without duplicates, has-more). Manual check: with > 10 orders scroll to the end → next 10 load with a spinner; tap "Cancelled" → only cancelled orders, count changes; type a farm name → list filters after a short pause; type "zzz" → "No matching orders" → "Clear filters" → full list; airplane mode → retry screen. Checks: npm test 7/7, lint 0/0, tsc pass. Not run on a device. Follow-ups: M30 (retire the unpaged route), M02 (tests for older libs).
### #2 — STRENGTHEN — lint — CF-0101 — M
What: `npm run lint` from 30 errors + 7 warnings to 0/0 with code fixes only (no rule or config change, no disable comments). refs ×20: `Animated.Value` held with lazy `useState`, not `useRef().current` (`Skeleton`, `ConfirmationScreen`); `AuthContext` writes `signedInRef` in an effect, not in render. set-state-in-effect ×8: `use-color-scheme.web` uses `useSyncExternalStore` for hydration; `ListingForm` resets its fields during render when it opens or the listing changes; `OrderScreen` derives empty search hits for a query < 2 chars; `TrackScreen` keys tracking data by order ID (no stale ETA after an order switch); `Listings` / `MerchantOrders` split a pure `fetch*` (tagged result) from `apply` (sets state in `.then`), and the error now clears after a good reload; `Notifications` / `Confirmation` set state in `.then`. Unescaped `'` ×3 → `’`. Warnings: unused imports/vars removed (dead `ProtectedScreen` styles, `AuthScreen` `width`), missing hook deps added. Why: M01 — lint must pass before any later commit (§5). Tests: no mobile tests yet (M02 next). Manual check: My listings → edit a listing → cancel → edit another (fields show the second one); Track with 2 orders → switch (no old ETA shows); search 1 char → no hits, 2+ chars → hits; airplane mode → error on Listings / Merchant orders → back online, pull to refresh → error clears. Checks: lint pass (0/0), tsc pass, no mobile tests. Note: the log update missed the code commit (script error) and went in a second commit; no amend (no history rewrites). Follow-ups: M29 (new, found here).
### #1 — AUDIT — all — (no CF ID) — M
What: created this log, branch `improve/mobile-loop` (own worktree), parity matrix (29 rows), 28-item backlog. Compared mobile `src/lib/api.ts` routes with web `util/api/*`. Found by reading code (not from §2): M01 lint red (30 errors), M14 `mockData.ts` kept only for a type + Unsplash hot-link + "⭐ 0" rating, M13 `app/(tabs)/App.tsx` is a stray route that duplicates providers, M12 checkout URL opened with no host check, M26 raw error logging, M10 no https guard. Checked and NOT a bug: `OnboardingScreen` opens `/merchantOnboarding`, the web redirects it to `/merchant/onboarding` (`lib/urls.ts:145`). Web log: B34 (area `mobile`, epic `parity`) copied as M04 + M06. Why: no state file existed. Tests: none (survey). Checks: tsc pass; lint FAIL (pre-existing, 30 errors / 7 warnings); no mobile tests yet; expo-doctor 20/20. Follow-ups: #2 must be M01 (broken first), then M02, then PARITY M04/M03.

## Health (refreshed on AUDIT)
- Mobile tests: 7 in 1 file since #3 (`npm test`).
- `tsc --noEmit`: pass.
- Lint: pass, 0 errors / 0 warnings since #2 (was 30 + 7 at #1).
- `npm audit --omit=dev`: 3 moderate (minimatch via `@expo/fingerprint`, see Needs human).
- `expo-doctor`: 20/20 checks pass.
- Largest files: `src/lib/api.ts` 528 (split by domain soon), `AuthScreen` 459, `MerchantScreen` 417, `ConfirmationScreen` 379, `ProfileScreen` 346, `CheckoutScreen` 343, `TrackScreen` 342.
- Parity score: 8 / 26 (since #3).
