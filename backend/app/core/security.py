"""Checks the access tokens BetterAuth issues.

BetterAuth (the Next.js app) is the only identity provider. Its jwt plugin signs
short-lived EdDSA tokens; this module verifies them with the public keys served
at ``/api/auth/jwks``. The backend holds no signing key, so it cannot mint
tokens and a backend leak cannot be used to forge one.

There are two web deploys (documentation/manuals/SUBDOMAINS.md), each with its
own signing keys:

- public (carabao.<root>, merchant.<root>): keys in the ``jwks`` table;
- admin (admin.<root>): keys in ``jwks_admin``, encrypted with that deploy's
  own ``BETTER_AUTH_SECRET``.

The surface of a token comes ONLY from the key set that verified it. A
``surface`` claim that does not agree is refused (401). The admin API needs a
token that the admin key set verified.

Settings:
- ``AUTH_JWT_ISSUER`` (falls back to ``BETTER_AUTH_URL``):
  the public web origin, the issuer of every token (both deploys).
- ``PUBLIC_JWKS_URL``: defaults to
  ``<issuer>/api/auth/jwks``.
- ``ADMIN_JWKS_URL``: the admin deploy's ``/api/auth/jwks``, on a route that
  does not go through Cloudflare Access (Railway private network). Unset: no
  admin tokens are accepted.
- ``ADMIN_JWKS_THUMBPRINTS``: the RFC 7638 thumbprints of the admin keys the API
  trusts, comma separated (``scripts/admin_jwk_thumbprints.py`` prints them).
  The admin deploy serves every row of ``jwks_admin`` without checking it, and
  the public deploy shares that database: a key someone writes into the table
  is served too. Only a pinned key verifies an admin token, also when a planted
  row reuses a real "kid". Empty: no admin tokens are accepted.
- ``BETTER_AUTH_JWT_AUDIENCE``: defaults to ``carabao-api``; must match lib/auth.ts.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

import jwt
from cryptography.hazmat.primitives.asymmetric.ed448 import Ed448PublicKey
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

DEFAULT_AUDIENCE = "carabao-api"
ALGORITHMS = ["EdDSA"]
# Small allowance for clock drift between the Next.js and FastAPI hosts.
LEEWAY_SECONDS = 30
# Key sets are kept this long; an unknown "kid" refetches sooner (key rotation).
JWKS_TTL_SECONDS = 3600
# At most one refetch per key set in this time, so tokens with random "kid"
# values cannot make the API flood the web app with JWKS requests.
JWKS_REFRESH_MIN_INTERVAL_SECONDS = 30

PUBLIC_SURFACE = "public"
ADMIN_SURFACE = "admin"

_INVALID = "Invalid or expired access token"


def _origin(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().strip('"').rstrip("/")
    if not value:
        return None
    if not value.startswith("http"):
        value = f"https://{value}"
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)


def token_issuer() -> str:
    issuer = _origin(os.getenv("AUTH_JWT_ISSUER")) or _origin(
        os.getenv("BETTER_AUTH_URL")
    )
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BETTER_AUTH_URL is not configured",
        )
    return issuer


def token_audience() -> str:
    return os.getenv("BETTER_AUTH_JWT_AUDIENCE", "").strip() or DEFAULT_AUDIENCE


def public_jwks_url() -> str:
    override = os.getenv("PUBLIC_JWKS_URL", "").strip()
    return override or f"{token_issuer()}/api/auth/jwks"


# Old name, kept for callers and tests.
jwks_url = public_jwks_url


def admin_jwks_url() -> str | None:
    return os.getenv("ADMIN_JWKS_URL", "").strip() or None


def admin_key_pins() -> frozenset[str]:
    raw = os.getenv("ADMIN_JWKS_THUMBPRINTS", "")
    return frozenset(pin for pin in re.split(r"[\s,]+", raw) if pin)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwk_thumbprint(key: Any) -> str | None:
    """RFC 7638 SHA-256 thumbprint of an EdDSA public key; None for other keys."""
    if isinstance(key, Ed25519PublicKey):
        crv = "Ed25519"
    elif isinstance(key, Ed448PublicKey):
        crv = "Ed448"
    else:
        return None
    x = _b64url(key.public_bytes(Encoding.Raw, PublicFormat.Raw))
    # Required members only, sorted, no whitespace (RFC 7638 section 3).
    canonical = json.dumps(
        {"crv": crv, "kty": "OKP", "x": x}, separators=(",", ":"), sort_keys=True
    )
    return _b64url(hashlib.sha256(canonical.encode()).digest())


@lru_cache(maxsize=1)
def _warn_admin_keys_not_pinned() -> None:
    logger.error(
        "ADMIN_JWKS_URL is set but ADMIN_JWKS_THUMBPRINTS is empty: no admin "
        "token is accepted. Run scripts/admin_jwk_thumbprints.py and set it."
    )


class _KeySet:
    """One JWKS URL. Cached; refetched for an unknown kid, rate limited."""

    def __init__(self, url: str) -> None:
        self.client = jwt.PyJWKClient(
            url, cache_jwk_set=True, lifespan=JWKS_TTL_SECONDS, timeout=5
        )
        self._lock = threading.Lock()
        self._last_refresh = 0.0

    def find(
        self, kid: str, *, refresh: bool, pins: frozenset[str] | None = None
    ) -> Any | None:
        """The key for ``kid``. With ``pins``, only a key whose thumbprint is
        pinned; a planted duplicate of a real kid is skipped, not returned."""
        if refresh:
            with self._lock:
                now = time.monotonic()
                if now - self._last_refresh < JWKS_REFRESH_MIN_INTERVAL_SECONDS:
                    return None
                self._last_refresh = now
        try:
            jwk_set = self.client.get_jwk_set(refresh=refresh)
        except jwt.PyJWKClientConnectionError:
            raise
        except (jwt.PyJWKClientError, jwt.PyJWKSetError):
            # No usable keys at this URL (yet): not this set.
            return None
        for jwk in jwk_set.keys:
            if jwk.key_id != kid:
                continue
            if pins is None:
                return jwk.key
            thumbprint = jwk_thumbprint(jwk.key)
            if thumbprint in pins:
                return jwk.key
            # A served key that is not pinned: a new key not yet pinned, or a
            # row written into the key table by someone else.
            logger.warning(
                "Admin key set serves an unpinned key (kid=%s, thumbprint=%s); "
                "refused.",
                kid,
                thumbprint,
            )
        return None


@lru_cache(maxsize=8)
def _jwk_client(url: str) -> _KeySet:
    return _KeySet(url)


@dataclass(frozen=True)
class SigningKey:
    key: Any
    surface: str


@dataclass(frozen=True)
class VerifiedToken:
    claims: dict[str, Any]
    surface: str


def _key_sources() -> list[tuple[str, str, frozenset[str] | None]]:
    """(surface, JWKS URL, pinned thumbprints or None for "any key")."""
    sources: list[tuple[str, str, frozenset[str] | None]] = [
        (PUBLIC_SURFACE, public_jwks_url(), None)
    ]
    admin_url = admin_jwks_url()
    if admin_url:
        pins = admin_key_pins()
        if pins:
            sources.append((ADMIN_SURFACE, admin_url, pins))
        else:
            _warn_admin_keys_not_pinned()
    return sources


def _signing_key(token: str) -> SigningKey:
    """The public key for this token's kid, and which key set holds it."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.DecodeError as exc:
        raise _unauthorized() from exc
    if not isinstance(kid, str) or not kid:
        raise _unauthorized()

    unreachable = False
    # Cached sets first; a refetch only when no set knows the kid.
    for refresh in (False, True):
        for surface, url, pins in _key_sources():
            try:
                key = _jwk_client(url).find(kid, refresh=refresh, pins=pins)
            except jwt.PyJWKClientConnectionError:
                unreachable = True
                continue
            if key is not None:
                return SigningKey(key=key, surface=surface)
    if unreachable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the sign-in service. Try again shortly.",
        )
    raise _unauthorized()


def verify_access_token(token: str) -> VerifiedToken:
    signing = _signing_key(token)
    try:
        claims = jwt.decode(
            token,
            signing.key,
            algorithms=ALGORITHMS,
            audience=token_audience(),
            issuer=token_issuer(),
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized() from exc
    # The claim is a label only; the key set decides. A token whose claim says
    # otherwise was not made by the deploy it names.
    claimed = claims.get("surface")
    if claimed is not None and claimed != signing.surface:
        raise _unauthorized()
    return VerifiedToken(claims=claims, surface=signing.surface)


def decode_access_token(token: str) -> dict[str, Any]:
    return verify_access_token(token).claims
