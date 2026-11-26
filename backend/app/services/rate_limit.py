"""Per-IP and per-identifier rate limits (E7, CF-0016; CF-0037 for actions).

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


# scope -> (per IP add, per identifier). Identifiers are emails, phone numbers or user ids.
LIMITS: dict[str, tuple[Limit, Limit]] = {
    "otp_send": (Limit(20, 900), Limit(5, 900)),
    "otp_verify": (Limit(30, 900), Limit(10, 900)),
    # Merchant contact-email codes; the identifier is the email.
    "email_otp_send": (Limit(20, 900), Limit(5, 900)),
    "email_otp_verify": (Limit(30, 900), Limit(10, 900)),
    # The password typed before an account-deletion code; the identifier is the user id.
    "password_check": (Limit(20, 900), Limit(5, 900)),
    # POST /admin/invites/accept (public); the identifier is the invite id. The
    # 5th wrong code ends the invite anyway (app/services/admin_accounts.py).
    "admin_invite_accept": (Limit(20, 900), Limit(10, 900)),
}

# scope -> per identifier, for server-to-server calls where the client IP is
# checked upstream (BetterAuth limits its OTP endpoints per IP), and for
# per-account limits.
IDENTIFIER_LIMITS: dict[str, Limit] = {
    # Signup / phone-change / password-reset codes per number. Lenient on
    # purpose (no CAPTCHA yet); tighten with ACCOUNT_OTP_PER_HOUR.
    "account_otp": Limit(int(os.getenv("ACCOUNT_OTP_PER_HOUR", "5")), 3600),
    # Site-wide: 5 codes an hour per signed-in user per channel. SMS codes
    # (merchant contact number, payout change) share one count, emailed codes
    # (merchant contact email) the other. The 60-second wait between codes to
    # one target is app/services/otp.py OTP_RESEND_COOLDOWN_SECONDS.
    "otp_send_user": Limit(5, 3600),
    "email_otp_send_user": Limit(5, 3600),
}


# CF-0037: scope -> limit for writes and lookups that are cheap to repeat and
# reach other people (merchant inboxes, admin support, the search log).
# Generous for a person, low enough to stop a script. The identifier is a
# user id, except ``produce_search`` (public), which is the client IP.
ACTION_LIMITS: dict[str, Limit] = {
    # Create + edit together; a buyer reviews a handful of orders at a time.
    "review_write": Limit(10, 3600),
    # Merchant replies to reviews, set + edit + delete (CF-0043).
    "review_reply": Limit(30, 3600),
    "order_chat_send": Limit(30, 60),
    "support_chat_send": Limit(20, 60),
    # Every search also writes a search_log row (demand insight).
    "produce_search": Limit(120, 60),
    # Guardrails: the listing form checks as the merchant types (400 ms pause).
    "produce_check": Limit(120, 60),
    # CF-0094 (B101): public, per client IP; each call reads and scores the
    # whole reference_prices table. No client calls it in a loop (the web and
    # mobile forms read GET /reference-prices once and match locally).
    "reference_price_match": Limit(60, 60),
    # CF-0045 (B50): each place locks stock rows and holds stock for the
    # reservation TTL; each checkout call can open a PayMongo session. A buyer
    # retrying a failed payment stays well under these.
    "order_place": Limit(20, 3600),
    "payment_checkout": Limit(30, 3600),
    # CF-0054 (B52): follow + unfollow; a person browses a few farms at a time.
    "farm_follow": Limit(60, 3600),
    # CF-0060 (B66): each shipment create geocodes the stops and calls the
    # Mapbox Matrix + Directions APIs, which are billed per request.
    "shipment_create": Limit(30, 3600),
    # CF-0060 (B67): avatar, shop logo/banner and produce photos together.
    # Each upload decodes and re-encodes an image and writes to R2.
    "image_upload": Limit(60, 3600),
    # CF-0069: a data export reads every order, message and review of a person.
    "data_export": Limit(5, 3600),
    # CF-0077: each merchant application submit scans two documents of up to
    # 20 MB (PDF object walk or image re-encode) and writes them to R2.
    "onboarding_submit": Limit(10, 3600),
    # Pin quality: each pin drop asks the road service for the nearest road
    # (billed per request). A person moves the pin a few times per address.
    "pin_check": Limit(120, 3600),
    # A rider reports a pin that could not be reached (control 6).
    "pin_report": Limit(60, 3600),
    # Order proof photos (packing, drop-off, failed drop-off). A run of 40
    # stops is 40 packing + 40 drop-off photos, with room for retakes.
    "proof_upload": Limit(200, 3600),
    # Proof photo reads through the API (each one reads from R2).
    "proof_view": Limit(300, 3600),
    # Pin quality item 3: saved address create + edit + delete, and shop
    # location edits, per user. Each write may ask the road service and run
    # the pin-area check; a person edits a few addresses at a time.
    "address_write": Limit(30, 3600),
    # Guardrails Phase 3: buyer reports on listings (per user).
    "listing_report": Limit(10, 3600),
    # Map pin picker: forward (typed address) and reverse (pin's area) Mapbox
    # geocoding together, billed per request. Each pin move asks once, each
    # address edit up to three times; repeats are answered from a cache.
    "place_search": Limit(240, 3600),
    # Street suggestions while typing (debounced; repeats come from a cache).
    "place_suggest": Limit(300, 3600),
    # The road line on the tracking / routing map (Mapbox Directions). Asked
    # once per page view and set of stops; repeats come from a cache.
    "route_view": Limit(120, 3600),
}


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def proxy_hops() -> int:
    """How many proxies of ours stand in front of the API (default 1)."""
    try:
        return max(1, int(os.getenv("RATE_LIMIT_PROXY_HOPS", "1")))
    except ValueError:
        return 1


def client_ip(request: Request) -> str:
    """The client address the per-IP limits count.

    CF-0083 (B36): behind our proxy, take the ``X-Forwarded-For`` entry that
    proxy added — the right-most one with one proxy (``RATE_LIMIT_PROXY_HOPS``
    for more). The left-most entry is whatever the client sent, so trusting it
    let anyone pick a new "IP" per request and skip every per-IP limit. This
    works whether the proxy appends to the header or replaces it.
    """
    if os.getenv("RATE_LIMIT_TRUST_PROXY", "").lower() in {"1", "true", "yes"}:
        forwarded = request.headers.get("x-forwarded-for", "")
        hops = [part.strip() for part in forwarded.split(",") if part.strip()]
        if hops:
            # Fewer entries than proxies: the left-most is the best we have.
            return hops[-min(proxy_hops(), len(hops))]
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


def enforce_action(db: Session, scope: str, identifier: str) -> None:
    """Raise 429 with Retry-After when ``identifier`` is over ``scope``'s limit.

    Commits ``db`` (see the module docstring), so call it first in the route.
    """
    limit = ACTION_LIMITS[scope]
    wait = _check_and_record(db, [(f"{scope}:id:{identifier.strip().lower()}", limit)])
    if wait is not None:
        retry_after = max(1, math.ceil(wait))
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many requests. Please try again in {_humanize(retry_after)}."
            ),
            headers={"Retry-After": str(retry_after)},
        )


def longest_window_seconds() -> int:
    windows = [limit.window_seconds for pair in LIMITS.values() for limit in pair]
    windows += [limit.window_seconds for limit in IDENTIFIER_LIMITS.values()]
    windows += [limit.window_seconds for limit in ACTION_LIMITS.values()]
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
