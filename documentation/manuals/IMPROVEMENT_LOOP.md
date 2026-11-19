# Carabao Improvement Loop — iteration prompt

Run with: `/loop 30m Follow documentation/manuals/IMPROVEMENT_LOOP.md exactly for one iteration.`

You are one iteration of a long-running improvement loop on Carabao, a Philippine
farm-produce marketplace (buyers, merchants/farms, admins). Each iteration has about
**10 minutes of working time** this working time can be maxed out or stopped early in the case of the feature already realized and completed, and no more integrations or improvements can be made in the current codebase. Ship one coherent, tested, committed improvement, record it,
and stop. The next iteration starts with no memory of this one: the state file is the only
memory, so keep it accurate. DO NOT PUSH THE CHANGES, keep it local
---

## 0. Orient (≤ 3 min)

1. Read `documentation/manuals/IMPROVEMENT_LOG.md` (the state file). If it is missing, create it
   from the template in §8 and do one full audit iteration (§3, kind `AUDIT`).
2. Read the parts of `documentation/manuals/SYSTEM_REFERENCE.md` and `SUBDOMAINS.md` that
   cover the area you will touch. These are the source of truth for architecture, env vars,
   values that must stay in step (§3 there), and the checks to run before a push.
3. `git status` and `git log --oneline -10`. If the working tree is dirty from a previous
   iteration that did not finish: if it passes the checks, finish and commit it as this
   iteration's work. If it does not, `git stash` it, add a note to the log, and continue.
4. Make sure you are on the loop branch named in the log header (create it from the current
   branch if needed). Never commit to `main`.

## 1. Pick the work (≤ 2 min). Do not skip this step.

Choose **one** item using these rules, in this order:

1. **Broken first.** If the last log entry says checks failed or something was left
   half-done, fix that first.
2. **Rotate kinds.** Iterations cycle through these kinds. Pick the kind that has gone the
   longest without being done. Use the "Kind balance" counters in the log.
   - `FEATURE`: a standard ecommerce capability that is missing or only partly there (§2A).
   - `STRENGTHEN`: make an existing flow more robust, complete, or usable (§2B).
   - `SECURITY`: find and fix a real weakness, or add a defense in depth (§2C).
   - `AUDIT`: about every 8th iteration. Re-survey the codebase, refresh the backlog,
     retire stale items, and add new ones. This is the main defense against local minima.
3. **Size floor (anti-local-minima).** An iteration must be at least **M** size:
   - **S**: a rename, a copy tweak, a single validation, one CSS fix. *Not allowed alone.*
     Batch 4 or more related S items under one theme ("all admin tables get empty states and
     pagination") to make an M.
   - **M**: one end-to-end improvement across 2 or more layers (model/route/UI/test), or one
     complete security fix with tests. *The default.*
   - **L**: a new feature spanning migration + API + web UI + tests. Split it into M slices
     and log the remaining slices as backlog items with the same `epic:` tag.
4. **Novelty check.** If 2 of the last 3 entries touched the same area (the same route file,
   page, or subsystem), pick a different area. If the last 3 entries were all `STRENGTHEN`
   or polish, the next must be `FEATURE` or `SECURITY`.
5. **Value over ease.** Within the chosen kind, prefer the backlog item with the highest
   `impact ÷ effort` that fits in this iteration. Do not pick something only because it is
   easy.

Write the choice into the log's "In progress" line **before** you start coding.

## 2. Idea sources (seed backlog — verify against the code before you build)

### 2A. Standard ecommerce features to check for (build what is missing)

Check what exists first. Some of these are already partly built (follows, reviews, reorder,
stock alerts, refunds, receipts, notifications, chat, tracking, demand insight).

- **Promotions:** voucher/promo codes (merchant-scoped and platform-wide; percent/fixed,
  min spend, usage caps, expiry), with server-side validation in checkout pricing via
  `services/money.py`. Flash sales or scheduled price drops.
- **Discovery:** saved items/wishlist for produce (not only farm follows); recently viewed;
  "similar produce / other farms selling this"; search facets (category, price range,
  distance/service area, rating, freshness), sort options, typo-tolerant search; category
  landing pages.
- **SEO/commerce surface:** extend `app/sitemap.ts` (farms, produce, categories), JSON-LD `Product`,
  `Offer`, `AggregateRating`, and `LocalBusiness` on farm/produce pages, canonical URLs.
- **Cart and checkout:** a persistent guest cart that merges on sign-in; save for later;
  stock and price-change warnings in the cart; order notes and delivery-window choice; an
  abandoned-cart reminder (notification/SMS through the existing services, opt-out respected).
- **Post-purchase:** downloadable invoice/receipt (PDF or print view); a buyer return/refund
  request flow tied to the existing refund service; review photos and helpful votes; a
  merchant reply to reviews.
- **Merchant tools:** bulk produce edit/CSV import-export; low-stock thresholds; sales
  reports with CSV export; a store hours/holiday mode that hides or flags listings; order
  batch actions.
- **Admin tools:** voucher management; a moderation queue for reviews and listings; a
  dashboard KPI trend; CSV export on tables; user impersonation **not** allowed (security).
- **Account:** order history filters and search; address book defaults; notification
  preferences per channel; data export (privacy).
- **Mobile parity:** when a web feature lands, log a backlog item for `mobile/CarabaoMobile`.

### 2B. Strengthening existing functions

- Add missing tests for untested routes/services (compare `backend/app/api/routes/*` with
  `backend/tests/test_*`). Add web pure-logic tests under `lib/` or `util/` and register them
  in the `npm test` script.
- Find and fix logic edge cases: money rounding, stock races at checkout (row locks), idempotency
  of webhook and payout handlers, timezone (Asia/Manila) boundaries, pagination limits, N+1
  queries, missing DB indexes on filtered and sorted columns (with an Alembic revision).
- UX completeness: loading, empty, and error states (`Skeleton`, `ErrorState`,
  `FieldError`); form validation that matches backend rules; accessibility (labels, focus,
  keyboard, contrast); mobile layouts; i18n coverage in `lib/i18n`.
- Consistency: shared API client error handling (`util/errorHelper.ts`), status enums kept in
  step (`statuses.py` ↔ `statuses.ts`), duplicated logic moved into helpers.
- Performance: heavy client components, unneeded re-fetching (`useVisiblePoll`), image sizes.

### 2C. Security (OWASP ASVS / API Top 10 lens)

- **Authorization (IDOR/BOLA):** every route that takes an ID must check ownership or role.
  Go route file by route file and add a test for each cross-user access attempt.
- Mass assignment in Pydantic schemas (`extra="forbid"`, no client-set price/status/owner
  fields); bounds and enums on every input; file upload checks (`upload_validation.py`).
- Rate limits on sensitive or abusable endpoints (search, chat, reviews, voucher redemption,
  sign-in-adjacent routes) through `services/rate_limit.py`.
- Webhook signature checks and replay windows; amounts always recomputed on the server.
- CSP: move toward `CSP_ENFORCE=true` by removing violations; security headers; cookie flags.
- Secrets/PII: no secrets or PII in logs or error bodies; field encryption coverage; the audit
  log covers every admin mutation.
- Dependencies: run `uv run pip list --outdated` / `npm audit --omit=dev`; upgrade only
  patch/minor versions inside an iteration, and log major upgrades as backlog items.
- Run the `/security-review` skill on the iteration's diff before committing a `SECURITY` item.

## 3. AUDIT iterations

Spend the iteration surveying, not coding (except trivial fixes you find). Produce:
- A refreshed backlog: 15–30 items, each with `kind`, `size`, `impact` (1–5),
  `effort` (1–5), `area`, a one-line acceptance test, and an `epic:` tag where relevant.
- Retire items that are done or no longer relevant. Merge duplicates.
- At least **5 new items not derived from §2**, found by reading the code: real bugs,
  missing guards, dead code, gaps between web and mobile, TODOs.
- A short "Health" note covering the test count, lint/mypy status, `npm audit` summary, and the largest
  files (refactor candidates).

## 4. Build (≤ 15 min)

- Follow the existing conventions: FastAPI routes in `app/api/routes`, logic in
  `app/services`, Pydantic schemas in `app/schemas`, SQLAlchemy models plus an **Alembic
  revision** for any schema change (never edit applied revisions), CSS modules on the frontend
  (no Tailwind), API wrappers in `util/api/*`.
- Tag the change with the next free `CF-00NN` ID (find the highest with
  `grep -rhoE "CF-[0-9]{4}" backend frontend | sort -u | tail -1`). Use it in comments at
  non-obvious decisions and in test docstrings, as the existing code does.
- Every behavior change needs tests. Backend tests use SQLite fixtures (`tests/conftest.py`),
  so no Postgres is needed. Mock external services (PayMongo, Semaphore, Resend, R2, Mapbox);
  never call them for real.
- Update `SYSTEM_REFERENCE.md` / `SUBDOMAINS.md` in the same change when you change a fact
  they state (env vars, files, processes, values kept in step).
- If you are running out of time, cut scope rather than quality: ship a smaller vertical slice
  that works and log the rest.

## 5. Verify (≤ 4 min). All must pass before a commit.

```
cd backend && uv run pytest -q && uv run ruff check . && uv run mypy .
cd frontend/carabao-app && npm test && npm run lint && npx tsc --noEmit
```

Run `npm run build` on `FEATURE` iterations that touch the web app, or every 4th iteration.
If a check was already failing before your change, record it in the log and do not hide it.
**Never** skip, delete, or weaken a test or a lint rule to get to green.

## 6. Commit and log (≤ 2 min)

- One commit per iteration on the loop branch:
  `<KIND>(<area>): <what changed> [CF-00NN]`, with a body of 2–5 lines saying why and how it was tested.
- Push only if the log header says `push: yes`, and only to the loop branch.
- Update `IMPROVEMENT_LOG.md`: add the history entry, update the kind balance, remove or
  adjust backlog items, add any follow-ups you found, and clear "In progress". Commit the
  log update in the same commit.

## 7. Hard rules

- Do not touch: `.env*` files, real secrets, production config, or `main`. No force-push,
  no history rewrites.
- No destructive migrations (dropping columns or tables with data) without a two-step plan:
  first a backlog item, then a migration in a later iteration.
- Do not change values listed in SYSTEM_REFERENCE §3 ("must stay in step") on only one side.
- Do not add a paid or external service. Use the integrations that already exist.
- Do not add large new dependencies without a log note on why. Prefer the standard library
  or what is already installed.
- If a task turns out to be bigger than planned, stop at a working slice. Do not leave the
  tree broken. A small, green, committed iteration beats an ambitious, red one.
- If you are blocked (you need credentials, a product decision, or a destructive change), log
  it under "Needs human" and pick something else. Do not stall.

## 8. State file template (`documentation/manuals/IMPROVEMENT_LOG.md`)

```markdown
# Improvement Log
branch: improve/loop    push: no    iteration: 0

## In progress
(none)

## Kind balance (count / last iteration #)
FEATURE 0/- · STRENGTHEN 0/- · SECURITY 0/- · AUDIT 0/-

## Needs human
- ...

## Backlog (highest impact÷effort first)
| id | kind | size | impact | effort | area | epic | item — acceptance test |
|----|------|------|--------|--------|------|------|------------------------|

## History (newest first; keep last 30, summarize older ones in one line each)
### #N — KIND — area — CF-00NN — size
What: ...  Why: ...  Tests: ...  Checks: pass/fail (details)  Follow-ups: ...

## Health (refreshed on AUDIT)
...
```
