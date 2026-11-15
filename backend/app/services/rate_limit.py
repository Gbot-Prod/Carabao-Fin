"""Per-IP and per-identifier rate limits for the OTP endpoints (E7, CF-0016).

Sign-in, sign-up and BetterAuth's phone OTP endpoints are limited per IP by
BetterAuth (lib/auth.ts rateLimit); the backend adds the per-number limit.

A sliding window over the ``rate_limit_hits`` table, so every API worker and
instance shares the same counts. In Postgres a transaction-level advisory lock
per key makes the check-then-record step atomic across workers. Old hits are
deleted by ``purge_expired`` (the cleanup loop in main.py).

Each call commits the session it is given, so the hit stays counted even when
the request fails after it (a wrong code, an SMS error). Call it before the
route has other changes waiting in that session.

Behind a proxy (Railway, Vercel) set RATE_LIMIT_TRUST_PROXY=true so the client
IP is read from X-Forwarded-For; otherwise every request shares the proxy's IP.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.models.otp import RateLimitHit


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
# checked upstream (BetterAuth limits its OTP endpoints per IP), and for
# per-account limits.
IDENTIFIER_LIMITS: dict[str, Limit] = {
    # Signup / phone-change / password-reset codes per number. Lenient on
    # purpose (no CAPTCHA yet); tighten with ACCOUNT_OTP_PER_HOUR.
    "account_otp": Limit(int(os.getenv("ACCOUNT_OTP_PER_HOUR", "5")), 3600),
    # Merchant contact-number codes per signed-in user, across numbers.
    "otp_send_user": Limit(5, 3600),
}


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def client_ip(request: Request) -> str:
    if os.getenv("RATE_LIMIT_TRUST_PROXY", "").lower() in {"1", "true", "yes"}:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def lock_keys(db: Session, *keys: str) -> None:
    """Hold Postgres advisory locks on ``keys`` until the transaction ends.

    Keys are locked in sorted order so two requests cannot deadlock. SQLite
    (tests) allows one writer at a time, so it needs no lock.
    """
    if db.get_bind().dialect.name != "postgresql":
        return
    for key in sorted(set(keys)):
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": key},
        )


def _wait_seconds(db: Session, key: str, limit: Limit, now: datetime) -> float | None:
    """Seconds until ``key`` may be hit again, or None if it is under its limit."""
    since = now - timedelta(seconds=limit.window_seconds)
    count, oldest = (
        db.query(func.count(RateLimitHit.id), func.min(RateLimitHit.hit_at))
        .filter(RateLimitHit.key == key, RateLimitHit.hit_at > since)
        .one()
    )
    if count < limit.max_hits or oldest is None:
        return None
    return (_aware(oldest) - since).total_seconds()


def _check_and_record(db: Session, keys: list[tuple[str, Limit]]) -> float | None:
    """Record a hit on every key, unless one is over its limit.

    All counters are checked before any is recorded, so a rejected request
    doesn't use up the other counters. Returns the wait in seconds when rejected.
    """
    now = _now()
    try:
        lock_keys(db, *(key for key, _ in keys))
        waits = [
            wait
            for key, limit in keys
            if (wait := _wait_seconds(db, key, limit, now)) is not None
        ]
        if not waits:
            db.add_all(RateLimitHit(key=key, hit_at=now) for key, _ in keys)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return max(waits) if waits else None


def enforce(
    db: Session, request: Request, scope: str, identifier: str | None = None
) -> None:
    """Raise 429 with Retry-After when the caller's IP or identifier is over limit."""
    ip_limit, id_limit = LIMITS[scope]
    keys = [(f"{scope}:ip:{client_ip(request)}", ip_limit)]
    if identifier:
        keys.append((f"{scope}:id:{identifier.strip().lower()}", id_limit))
    wait = _check_and_record(db, keys)
    if wait is not None:
        retry_after = max(1, math.ceil(wait))
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Please try again in {_humanize(retry_after)}.",
            headers={"Retry-After": str(retry_after)},
        )


def enforce_identifier(db: Session, scope: str, identifier: str) -> None:
    """Raise 429 with Retry-After when ``identifier`` is over its limit."""
    limit = IDENTIFIER_LIMITS[scope]
    wait = _check_and_record(db, [(f"{scope}:id:{identifier.strip().lower()}", limit)])
    if wait is not None:
        retry_after = max(1, math.ceil(wait))
        raise HTTPException(
            status_code=429,
            detail=(
                "Too many codes requested. "
                f"Please try again in {_humanize(retry_after)}."
            ),
            headers={"Retry-After": str(retry_after)},
        )


def longest_window_seconds() -> int:
    windows = [limit.window_seconds for pair in LIMITS.values() for limit in pair]
    windows += [limit.window_seconds for limit in IDENTIFIER_LIMITS.values()]
    return max(windows)


def purge_expired(db: Session) -> int:
    """Delete hits older than every window. The caller commits."""
    cutoff = _now() - timedelta(seconds=longest_window_seconds())
    return (
        db.query(RateLimitHit)
        .filter(RateLimitHit.hit_at <= cutoff)
        .delete(synchronize_session=False)
    )


def _humanize(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} seconds"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"
