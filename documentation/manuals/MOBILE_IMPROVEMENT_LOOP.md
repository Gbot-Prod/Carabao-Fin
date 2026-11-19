# Carabao Mobile Improvement Loop — iteration prompt

Run with: `/loop 30m Follow documentation/manuals/MOBILE_IMPROVEMENT_LOOP.md exactly for one iteration.`

You are one iteration of a long-running improvement loop on the Carabao **mobile app**
(`mobile/CarabaoMobile`, Expo / React Native / expo-router). The web app
(`frontend/carabao-app`) is ahead. The main goal of this loop is to **bring the mobile app
up to the web app** for buyers and merchants, and then keep it there. Admins stay web-only
(`ADMIN_WEB_ONLY`). Do not port admin screens.

Each iteration has about **10 minutes of working time**. You can stop early if the item is
done and no more useful work fits. Ship one coherent, tested, committed improvement, record
it, and stop. The next iteration starts with no memory of this one: the state file is the
only memory, so keep it accurate. DO NOT PUSH THE CHANGES. Keep them local.

---

## 0. Orient (≤ 3 min)

1. Read `documentation/manuals/MOBILE_IMPROVEMENT_LOG.md` (the state file). If it is
   missing, create it from the template in §8 and do one full audit iteration (§3, kind
   `AUDIT`). The first audit must also fill the **Parity matrix**.
2. Read the parts of `documentation/manuals/SYSTEM_REFERENCE.md` that cover the area you
   will touch (§4.3 mobile env vars, §3 values that must stay in step, auth rules for
   mobile). These are the source of truth.
3. Read the web loop log `documentation/manuals/IMPROVEMENT_LOG.md`, history and backlog
   only. Web iterations can add new features and new backend routes. Each new web feature
   for buyers or merchants is a new parity gap. Each backlog item there with area `mobile`
   or epic `parity` belongs to this loop: copy it into this backlog (keep its old ID in the
   text, for example "was web B34").
4. `git status` and `git log --oneline -10`. If the working tree is dirty from a previous
   iteration that did not finish: if it passes the checks, finish and commit it as this
   iteration's work. If it does not, `git stash` it, add a note to the log, and continue.
5. Make sure you are on the loop branch named in the log header (create it from the current
   branch if needed). Never commit to `main`. Do not run this loop and the web loop at the
   same time on the same working tree.

## 1. Pick the work (≤ 2 min). Do not skip this step.

Choose **one** item using these rules, in this order:

1. **Broken first.** If the last log entry says checks failed or something was left
   half-done, fix that first.
2. **Rotate kinds.** Pick the kind that has gone the longest without being done. Use the
   "Kind balance" counters in the log. Parity is the main goal, so `PARITY` gets **2 turns
   for each 1 turn** of the other kinds.
   - `PARITY`: a buyer or merchant capability that the web app has and the mobile app does
     not have, or has only in part (§2A).
   - `STRENGTHEN`: make an existing mobile flow more robust, complete, or usable (§2B).
   - `SECURITY`: find and fix a real mobile weakness, or add a defense in depth (§2C).
   - `AUDIT`: about every 8th iteration. Re-survey web and mobile, refresh the parity
     matrix and the backlog. This is the main defense against local minima.
3. **Size floor (anti-local-minima).** An iteration must be at least **M** size:
   - **S**: a rename, a copy tweak, a single validation, one style fix. *Not allowed
     alone.* Batch 4 or more related S items under one theme ("all list screens get
     pull-to-refresh and empty states") to make an M.
   - **M**: one complete mobile screen or flow that works end to end against the real API
     (API wrapper + screen + navigation + test), or one complete security fix with tests.
     *The default.*
   - **L**: a feature that also needs a new backend route or a migration. Split it into M
     slices and log the remaining slices as backlog items with the same `epic:` tag.
4. **Novelty check.** If 2 of the last 3 entries touched the same screen or subsystem, pick
   a different area. If the last 3 entries were all `STRENGTHEN` or polish, the next must
   be `PARITY` or `SECURITY`.
5. **Value over ease.** Within the chosen kind, prefer the backlog item with the highest
   `impact ÷ effort` that fits in this iteration. Buyer purchase paths (find → cart →
   checkout → pay → track) come before merchant tools. Merchant tools come before
   nice-to-have items. Do not pick something only because it is easy.

Write the choice into the log's "In progress" line **before** you start coding.

## 2. Idea sources (seed backlog — verify against the code before you build)

### 2A. Parity with the web app

Compare each web page with the mobile screen that does the same job. Web pages are in
`frontend/carabao-app/app/(site)/`. Mobile routes are in `mobile/CarabaoMobile/app/` and
the screens are in `src/screens/`. The web API wrappers in `frontend/carabao-app/util/api/*`
show which backend routes each web feature calls. Compare them with
`mobile/CarabaoMobile/src/lib/api.ts`.

Known web surfaces to check (verify each one, some may already be on mobile):

- **Buyer — discovery:** farm list and farm detail (`farms`, `farms/[merchantID]`) with
  reviews, follow, and the farm's produce; produce search with filters, sort, and paging;
  saved produce (heart + `saved` screen); recently viewed; similar produce.
- **Buyer — cart and checkout:** server cart sync and merge on sign-in; stock and price
  change warnings; order notes and delivery choices; address book with a default; the same
  checkout pricing that the server returns (never compute the total only on the phone).
- **Buyer — orders:** order history with status filters, search, and paging
  (`/orders/me/history/page`, then retire the unpaged route — was web B34); order detail
  (`orders/[orderId]`); receipt view; reorder; refund or return request; reviews with
  photos; order chat; live tracking.
- **Buyer — account:** profile edit, phone and email verification, password reset,
  notification preferences, account deletion, data export, language (web `lib/i18n`).
- **Merchant:** the web merchant shell tabs — dashboard, produce, inventory and stock
  alerts, orders, shipments and routing, chats, reviews and replies, sales, earnings and
  cash-out (payout destination lock), shop page (banner, logo, details), settings, danger
  zone, onboarding. Mobile today has `merchant.tsx`, `merchant-orders.tsx`, and
  `listings.tsx` only.
- **Mock data:** `src/lib/mockData.ts` is still used by `FarmCard.tsx` and
  `OrderScreen.tsx`. Replace each mock with real API data. This is parity work.
- **Native extras that the web cannot do** (after the main gaps close): push
  notifications through the existing notification service, image pick from camera for
  listings and review photos, share sheet for farm and produce links, deep links
  (`carabaomobile://`) that open the matching screen.

### 2B. Strengthening existing mobile flows

- **Tests.** The mobile app has no test runner yet. The first `STRENGTHEN` iteration adds a
  `test` script that uses `node --test` on pure logic files in `src/lib/` (the same
  pattern as the web app's `npm test`). Start with `cartGroups.ts`, `orderStatus.ts`,
  `phone.ts`, `passwordPolicy.ts`, `referencePrices.ts`, `idle.ts`. Each later iteration
  that adds pure logic adds a test file and registers it in the script. Put logic that can
  be tested in `src/lib/`, not inside screens.
- **Values kept in step with web and backend:** order status enums (`orderStatus.ts` ↔ web
  `statuses.ts` ↔ backend `statuses.py`), phone format, password policy, upload limits.
  When they differ, the backend is correct.
- **UX completeness:** loading (`Skeleton`), empty, error, and offline states
  (`expo-network`); pull-to-refresh; retry on network failure; keyboard-safe forms;
  form validation that matches backend rules and shows the backend field errors;
  accessibility (`accessibilityLabel`, `accessibilityRole`, touch targets ≥ 44 pt, dynamic
  text size, contrast); dark mode through `constants/theme.ts` / `src/lib/theme.ts`.
- **Cleanup:** remove the Expo starter files that no screen uses (`hello-wave`,
  `parallax-scroll-view`, `modal`, `external-link`, `app/(tabs)/App.tsx` if unused).
  Check every import before you delete. Merge `constants/theme.ts` and `src/lib/theme.ts`
  if they do the same job.
- **Consistency:** one API error path through `ApiError` in `src/lib/api.ts`; shared UI
  parts in `src/components/UI.tsx`; no copy-pasted fetch logic in screens.
- **Performance:** `FlatList` (not `ScrollView` + `map`) for long lists, `keyExtractor`,
  memoized rows, `expo-image` with sizes for photos, no polling when the screen is not
  focused or the app is in the background.

### 2C. Security (OWASP MASVS lens)

- **Storage:** session tokens only in `expo-secure-store`, never in `AsyncStorage`. No PII
  in `AsyncStorage` that is not needed for offline use. Clear all stored user data on
  sign-out and on account deletion.
- **Config:** every `EXPO_PUBLIC_*` value is public in the app bundle. No secrets there.
  Production builds must use `https` for `API_BASE` and `WEB_BASE`.
- **Auth:** admin sign-in stays refused on mobile. Idle sign-out (`idle.ts`) works. A 401
  from the API signs the user out cleanly. The merchant screens check the role from the
  server, not only from local state.
- **Deep links and web views:** validate every deep link parameter before use; open only
  allow-listed hosts in `expo-web-browser`; the payment return path must check the
  transaction status with the server, never trust the URL.
- **Input and upload:** the same bounds as the backend on all inputs; image uploads go
  only through the upload routes (the backend refuses image URLs in JSON bodies).
- **Logs:** no tokens, phone numbers, addresses, or payment data in `console.log` calls.
- **Dependencies:** `npm audit --omit=dev` in `mobile/CarabaoMobile`; upgrade only
  patch/minor inside an iteration. Expo SDK upgrades go to "Needs human".
- Run the `/security-review` skill on the iteration's diff before you commit a
  `SECURITY` item.

## 3. AUDIT iterations

Spend the iteration on a survey, not on code (except trivial fixes you find). Produce:
- A refreshed **Parity matrix** in the log: one row per web buyer/merchant page or feature,
  with the mobile screen that matches it and a status (`done` / `partial` / `missing` /
  `n/a — web-only`), plus the backend routes it needs and whether they exist.
- A refreshed backlog: 15–30 items, each with `kind`, `size`, `impact` (1–5),
  `effort` (1–5), `area`, a one-line acceptance test, and an `epic:` tag where relevant.
- Retire items that are done or no longer relevant. Merge duplicates.
- At least **5 new items not derived from §2**, found by reading the code: real bugs,
  missing guards, dead code, mock data, TODOs, screens that call routes that no longer
  exist.
- A short "Health" note: mobile test count, `tsc` and lint status, `npm audit` summary,
  `expo-doctor` summary, the largest screens (refactor candidates), and the parity score
  (done ÷ total rows).

## 4. Build (≤ 15 min)

- Follow the existing mobile conventions: routes in `app/` are thin and render a screen
  from `src/screens/`; API calls and types go in `src/lib/api.ts` (split it by domain when
  it grows, for example `src/lib/api/orders.ts`); shared state in `src/lib/*Context.tsx`;
  shared UI in `src/components/`; styles with `StyleSheet.create` and the theme tokens.
- Reuse the **existing backend routes** that the web app already calls. Do not build a
  mobile-only copy of a route. If a backend change is really necessary (an L item), follow
  the backend rules of the web loop (`IMPROVEMENT_LOOP.md` §4: services, schemas, Alembic
  revision, tests with SQLite fixtures, mocks for external services) and add a line to the
  web log history so the web loop knows.
- Do not copy web code that uses DOM or Next.js APIs. Port the logic, not the markup.
  Pure helpers that the web app has in `lib/` can be copied into `src/lib/` with the same
  name and the same tests. Mark the copy with a comment that names the web file, so both
  sides stay in step.
- Tag the change with the next free `CF-00NN` ID (find the highest with
  `grep -rhoE "CF-[0-9]{4}" backend frontend mobile/CarabaoMobile/src mobile/CarabaoMobile/app | sort -u | tail -1`).
  Use it in comments at non-obvious decisions and in test names. The ID sequence is shared
  with the web loop.
- Every behavior change needs tests. Pure logic gets a `node --test` file. Screen work that
  cannot be unit-tested gets a short manual test note in the log entry (what to tap, what
  to see), and the logic behind it moves into `src/lib/` with a test.
- Update `SYSTEM_REFERENCE.md` in the same change when you change a fact it states (mobile
  env vars, files, the app scheme, values kept in step).
- If you are running out of time, cut scope, not quality: ship a smaller vertical slice
  that works and log the rest.

## 5. Verify (≤ 4 min). All must pass before a commit.

```
cd mobile/CarabaoMobile && npm test && npm run lint && npx tsc --noEmit
```

Until the `test` script exists (§2B), record "no mobile tests yet" in the log entry.
If the iteration changed the backend, also run the backend checks:

```
cd backend && uv run pytest -q && uv run ruff check . && uv run mypy .
```

Run `npx expo-doctor` on `PARITY` iterations that add a dependency, and every 4th
iteration. Run `npx expo export --platform android` every 4th iteration to prove the
bundle builds. If a check was already failing before your change, record it in the log and
do not hide it. **Never** skip, delete, or weaken a test or a lint rule to get to green.

## 6. Commit and log (≤ 2 min)

- One commit per iteration on the loop branch:
  `<KIND>(mobile/<area>): <what changed> [CF-00NN]`, with a body of 2–5 lines saying why
  and how it was tested.
- Push only if the log header says `push: yes`, and only to the loop branch.
- Update `MOBILE_IMPROVEMENT_LOG.md`: add the history entry, update the kind balance and
  the parity matrix row, remove or adjust backlog items, add any follow-ups you found, and
  clear "In progress". If the item came from the web log, mark it as moved there too.
  Commit the log updates in the same commit.

## 7. Hard rules

- Do not touch: `.env*` files, real secrets, production config, `app.json` signing or
  bundle IDs, EAS credentials, or `main`. No force-push, no history rewrites.
- No admin features on mobile. `ADMIN_WEB_ONLY` stays.
- Do not change the app scheme `carabaomobile://` or other values listed in
  SYSTEM_REFERENCE §3 ("must stay in step") on only one side.
- Do not upgrade the Expo SDK or React Native major version inside an iteration. Log it
  under "Needs human".
- Do not add native modules that need a custom dev build (not in Expo Go) without a log
  note and a "Needs human" entry first.
- Do not add a paid or external service. Use the integrations that already exist.
- Do not add large new dependencies without a log note on why. Prefer what Expo already
  ships.
- If a task turns out to be bigger than planned, stop at a working slice. Do not leave the
  tree broken. A small, green, committed iteration beats an ambitious, red one.
- If you are blocked (you need a device test, credentials, a product decision, or a
  destructive change), log it under "Needs human" and pick something else. Do not stall.

## 8. State file template (`documentation/manuals/MOBILE_IMPROVEMENT_LOG.md`)

```markdown
# Mobile Improvement Log
branch: improve/mobile-loop    push: no    iteration: 0    target: 20

## In progress
(none)

## Kind balance (count / last iteration #)
PARITY 0/- · STRENGTHEN 0/- · SECURITY 0/- · AUDIT 0/-

## Needs human
- ...

## Parity matrix (refreshed on AUDIT, row updated on each PARITY)
| web page / feature | mobile screen | status | backend routes | notes |
|--------------------|---------------|--------|----------------|-------|

Parity score: 0 / 0

## Backlog (highest impact÷effort first)
| id | kind | size | impact | effort | area | epic | item — acceptance test |
|----|------|------|--------|--------|------|------|------------------------|

## History (newest first; keep last 30, summarize older ones in one line each)
### #N — KIND — area — CF-00NN — size
What: ...  Why: ...  Tests: ...  Manual check: ...  Checks: pass/fail (details)  Follow-ups: ...

## Health (refreshed on AUDIT)
...
```
