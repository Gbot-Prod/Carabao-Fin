# Mobile Improvement Log
branch: improve/mobile-loop    push: no    iteration: 1    target: 20

Worktree: this loop runs in its own git worktree (not the main checkout, not the web loop's
`improve/loop` worktree). `node_modules` is installed per worktree (`npm ci`).

## In progress
(none)

## Kind balance (count / last iteration #)
PARITY 0/- · STRENGTHEN 0/- · SECURITY 0/- · AUDIT 1/#1

## Needs human
- `npm audit --omit=dev`: 3 moderate (minimatch ReDoS via `@expo/fingerprint` ← `expo`). The only
  "fix" npm offers is a downgrade to expo@52 (breaking). Wait for an Expo 58 patch that bumps
  `@expo/fingerprint`; do not force it in a loop iteration. Build-time tool, not in the app bundle.

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
| `orders` history | `(tabs)/history` → `HistoryScreen` | partial | uses unpaged `/orders/me/history`; `/orders/me/history/page` exists | no status filter, search, paging (was web B34) |
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

Parity score: 7 / 26 done (8 partial, 11 missing; 3 rows n/a)

## Backlog (highest impact÷effort first)
| id | kind | size | impact | effort | area | epic | item — acceptance test |
|----|------|------|--------|--------|------|------|------------------------|
| M01 | STRENGTHEN | M | 4 | 2 | lint | — | Lint is red before any change: 30 errors (react-hooks/refs ×20 in `ConfirmationScreen`, `Skeleton`, `AuthContext`; set-state-in-effect ×8 in 8 files; no-unescaped-entities ×3). Fix the code, do not weaken rules — test: `npm run lint` exits 0. |
| M02 | STRENGTHEN | M | 3 | 2 | tests | — | Add `npm test` (`node --test`, TS via `--experimental-strip-types` or compiled) for `cartGroups`, `orderStatus`, `phone`, `passwordPolicy`, `referencePrices`, `idle` — test: `npm test` passes with ≥ 6 files. |
| M03 | PARITY | M | 4 | 3 | orders | parity | Order detail screen `orders/[orderId]` (items, status, totals from server, cancel, confirm received) — test: open from history, cancel a pending order, see the new status. |
| M04 | PARITY | M | 4 | 2 | orders | parity | HistoryScreen → `/orders/me/history/page` with status filter, search, infinite scroll (was web B34) — test: 25 orders load in pages of 10; filter "cancelled" shows only cancelled. |
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
### #1 — AUDIT — all — (no CF ID) — M
What: created this log, branch `improve/mobile-loop` (own worktree), parity matrix (29 rows), 28-item backlog. Compared mobile `src/lib/api.ts` routes with web `util/api/*`. Found by reading code (not from §2): M01 lint red (30 errors), M14 `mockData.ts` kept only for a type + Unsplash hot-link + "⭐ 0" rating, M13 `app/(tabs)/App.tsx` is a stray route that duplicates providers, M12 checkout URL opened with no host check, M26 raw error logging, M10 no https guard. Checked and NOT a bug: `OnboardingScreen` opens `/merchantOnboarding`, the web redirects it to `/merchant/onboarding` (`lib/urls.ts:145`). Web log: B34 (area `mobile`, epic `parity`) copied as M04 + M06. Why: no state file existed. Tests: none (survey). Checks: tsc pass; lint FAIL (pre-existing, 30 errors / 7 warnings); no mobile tests yet; expo-doctor 20/20. Follow-ups: #2 must be M01 (broken first), then M02, then PARITY M04/M03.

## Health (refreshed on AUDIT)
- Mobile tests: none (no `test` script yet).
- `tsc --noEmit`: pass.
- Lint: FAIL, 30 errors + 7 warnings, all pre-existing (see M01).
- `npm audit --omit=dev`: 3 moderate (minimatch via `@expo/fingerprint`, see Needs human).
- `expo-doctor`: 20/20 checks pass.
- Largest files: `src/lib/api.ts` 528 (split by domain soon), `AuthScreen` 459, `MerchantScreen` 417, `ConfirmationScreen` 379, `ProfileScreen` 346, `CheckoutScreen` 343, `TrackScreen` 342.
- Parity score: 7 / 26.
