# Carabao-Fin Security Review Standard

The fixed baseline for every security review, scheduled or manual. Reviews check
against this file so results stay comparable from one run to the next.

## 1. Frameworks we review against

| Area | Standard | Target |
|---|---|---|
| Backend (FastAPI) + web (Next.js) | **OWASP ASVS 5.0** | **Level 2** (handles money and PII). Level 3 for payments, payouts, refunds, auth and admin. |
| REST API | **OWASP API Security Top 10 (2023)** | All 10. BOLA (API1) and BFLA (API5) come first. |
| Mobile (Expo / React Native) | **OWASP MASVS v2** | MASVS-STORAGE, -AUTH, -NETWORK, -PRIVACY, -CODE |
| Triage labels | **OWASP Top 10:2025** + **CWE** IDs | Every finding gets one category and one CWE |
| Severity | **CVSS v4.0** base score, mapped to Critical / High / Medium / Low | |
| Payments | **PCI DSS v4.0.1**, SAQ-A scope | Card data must never touch our servers. PayMongo handles it. |
| Privacy (PH) | **Data Privacy Act of 2012 (RA 10173)** + NPC Circular 16-01 / 2023-06 | Names, phones, addresses, GPS, chats. Breach notification within 72h. |
| Supply chain | OSV / `npm audit` / `pip-audit` | No known High/Critical CVE in a shipped dependency |
| Secrets | gitleaks-style scan of the working tree and git history | Zero committed secrets |

## 2. Carabao-specific hotspots (check every review)

1. **Money flows**: `backend/app/services/{paymongo,payout_service,refund_service,order_reservations}.py`, `api/routes/payments.py`, merchant cash-out.
   - Amounts and prices are computed on the server, never taken from the client.
   - Payout, refund and checkout updates are idempotent and safe under concurrent requests (row locks or a unique constraint, no read-then-write races, no double payout or refund).
   - State transitions follow `order_status.py`. A client can't skip to `paid`, `delivered` or `refunded`.
2. **PayMongo webhook** (`api/webhooks/paymongo.py`): the signature is verified on the raw body with a constant-time compare, there's a timestamp tolerance, event IDs are deduplicated, and the payment status is re-fetched from PayMongo before money moves.
3. **Object-level authorization (IDOR/BOLA)**: every route under `api/routes/` that takes an ID (orders, chat, support_chat, tracking, shipments, reviews, carts, merchant_sales, users) checks ownership or role on the server.
4. **Auth bridge**: `frontend/carabao-app/app/api/auth/backend-token` ↔ `backend/app/api/dependencies.py`. JWT algorithm is pinned, `exp`, `aud` and `iss` are checked, the secret is strong and comes from env, and the token never appears in a URL or a log.
5. **Admin and 2FA**: every `admin*` route needs the admin role **and** 2FA. Destructive admin actions write to the audit log. 2FA can't be bypassed by calling the backend directly.
6. **SMS / OTP / email** (`integrations/sms`, `routes/sms.py`, `routes/email.py`): rate limits, OTP expiry and attempt limits, no user enumeration, no SMS-pumping abuse.
7. **PII and location**: GPS and route data (RouteMap, tracking) and addresses are visible only to the parties on that order. API responses and logs don't leak PII.
8. **Injection**: no raw SQL built with f-strings or `text()` concatenation. No `dangerouslySetInnerHTML` with user content (chat, reviews, produce descriptions).
9. **Config**: CORS allowlist (not `*` with credentials), security headers / CSP in Next.js, `DEBUG` off in production, `.env*` stays gitignored, nothing secret in `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.
10. **Mobile**: tokens are kept in `expo-secure-store` (not AsyncStorage). No secrets in `app.json`. HTTPS only.

## 3. Severity and response targets

| Severity | CVSS v4 | Examples | Fix by |
|---|---|---|---|
| Critical | 9.0–10 | Forged webhook marks an order paid; any user can trigger a payout; leaked live secret | Immediately, before the next deploy |
| High | 7.0–8.9 | IDOR on orders or chat; 2FA bypass; refund race | 48h |
| Medium | 4.0–6.9 | Missing rate limit on OTP; verbose errors with PII | 2 weeks |
| Low | 0.1–3.9 | Missing header; outdated dependency with no reachable exploit | Backlog |

## 4. Finding format (required)

```
### [SEVERITY] <title>
- Location: path/to/file.py:123
- Standard: ASVS 5.0 V<x.y.z> | API<n>:2023 | MASVS-<X> | CWE-<n>
- CVSS v4: <score>
- Exploit scenario: <concrete steps an attacker takes and what they gain>
- Fix: <specific change>
- Confidence: High / Medium   (do not report Low-confidence guesses)
```

## 5. Out of scope / noise rules

- Don't report theoretical issues without a concrete exploit path in this codebase.
- Don't report DoS from large inputs unless it's unauthenticated and cheap to trigger.
- Test files, `backend/scripts/` and benchmarks are only in scope if they hold secrets.
- Don't repeat findings already listed in the latest report as "Accepted risk".