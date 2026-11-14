"""Per-IP and per-identifier rate limits for the OTP endpoints (E7).

Sign-in, sign-up and BetterAuth's phone OTP endpoints are limited per IP by
BetterAuth (lib/auth.ts rateLimit); the backend adds the per-number limit.

A sliding window held in process memory: enough for one API instance. With
several workers or instances each keeps its own counts, so the effective limit
is multiplied; move this to Redis or the database before scaling out.

Behind a proxy (Railway, Vercel) set RATE_LIMIT_TRUST_PROXY=true so the client
IP is read from X-Forwarded-For; otherwise every request shares the proxy's IP.
"""

from __future__ import annotations

import math
import os
import time
from collections import deque
from dataclasses import dataclass
from threading import Lock

from fastapi import HTTPException, Request


@dataclass(frozen=True)
class Limit:
    max_hits: int
    window_seconds: int


# scope -> (per IP, per identifier). Identifiers are emails, phone numbers or user ids.
LIMITS: dict[str, tuple[Limit, Limit]] = {
    "otp_send": (Limit(20, 900), Limit(5, 900)),
    "otp_verify": (Limit(30, 900), Limit(10, 900)),
}

# scope -> per identifier, for server-to-server calls where the client IP is
# checked upstream (BetterAuth limits its OTP endpoints per IP).
IDENTIFIER_LIMITS: dict[str, Limit] = {
    # Signup / phone-change / password-reset codes per number. Lenient on
    # purpose (no CAPTCHA yet); tighten with ACCOUNT_OTP_PER_HOUR.
    "account_otp": Limit(int(os.getenv("ACCOUNT_OTP_PER_HOUR", "5")), 3600),
}

_hits: dict[str, deque[float]] = {}
_lock = Lock()


def reset() -> None:
    """Forget every count (tests)."""
    with _lock:
        _hits.clear()


def client_ip(request: Request) -> str:
    if os.getenv("RATE_LIMIT_TRUST_PROXY", "").lower() in {"1", "true", "yes"}:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _check(key: str, limit: Limit, now: float) -> float | None:
    """Record a hit for ``key``; return seconds to wait if over the limit."""
    window = _hits.setdefault(key, deque())
    cutoff = now - limit.window_seconds
    while window and window[0] <= cutoff:
        window.popleft()
    if len(window) >= limit.max_hits:
        return window[0] + limit.window_seconds - now
    window.append(now)
    return None


def enforce(request: Request, scope: str, identifier: str | None = None) -> None:
    """Raise 429 with Retry-After when the caller's IP or identifier is over limit.

    Both counters are checked before either is recorded, so a rejected request
    doesn't use up the other counter.
    """
    ip_limit, id_limit = LIMITS[scope]
    now = time.monotonic()
    keys = [(f"{scope}:ip:{client_ip(request)}", ip_limit)]
    if identifier:
        keys.append((f"{scope}:id:{identifier.strip().lower()}", id_limit))
    with _lock:
        waits = []
        for key, limit in keys:
            window = _hits.get(key)
            if window is not None:
                cutoff = now - limit.window_seconds
                while window and window[0] <= cutoff:
                    window.popleft()
                if len(window) >= limit.max_hits:
                    waits.append(window[0] + limit.window_seconds - now)
        if waits:
            retry_after = max(1, math.ceil(max(waits)))
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many attempts. Please try again in {_humanize(retry_after)}."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        for key, limit in keys:
            _check(key, limit, now)


def enforce_identifier(scope: str, identifier: str) -> None:
    """Raise 429 with Retry-After when ``identifier`` is over its limit."""
    limit = IDENTIFIER_LIMITS[scope]
    with _lock:
        wait = _check(
            f"{scope}:id:{identifier.strip().lower()}", limit, time.monotonic()
        )
    if wait is not None:
        retry_after = max(1, math.ceil(wait))
        raise HTTPException(
            status_code=429,
            detail=f"Too many codes requested. Please try again in {_humanize(retry_after)}.",
            headers={"Retry-After": str(retry_after)},
        )


def _humanize(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} seconds"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"
