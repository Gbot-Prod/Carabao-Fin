"""Checks the access tokens BetterAuth issues.

BetterAuth (the Next.js app) is the only identity provider. Its jwt plugin signs
short-lived EdDSA tokens; this module verifies them with the public keys served
at ``/api/auth/jwks``. The backend holds no signing key, so it cannot mint
tokens and a backend leak cannot be used to forge one.

Settings:
- ``BETTER_AUTH_URL`` (falls back to ``FRONTEND_URL``): the web app's origin,
  which is also the token issuer.
- ``BETTER_AUTH_JWKS_URL``: overrides ``<BETTER_AUTH_URL>/api/auth/jwks``.
- ``BETTER_AUTH_JWT_AUDIENCE``: defaults to ``carabao-api``; must match lib/auth.ts.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

import jwt
from fastapi import HTTPException, status

DEFAULT_AUDIENCE = "carabao-api"
ALGORITHMS = ["EdDSA"]
# Small allowance for clock drift between the Next.js and FastAPI hosts.
LEEWAY_SECONDS = 30


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


def token_issuer() -> str:
    # FRONTEND_URL may be a comma-separated list (it doubles as the CORS list);
    # the first entry is the web app's own origin.
    frontend = os.getenv("FRONTEND_URL", "").split(",")[0]
    issuer = _origin(os.getenv("BETTER_AUTH_URL")) or _origin(frontend)
    if not issuer:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BETTER_AUTH_URL is not configured",
        )
    return issuer


def token_audience() -> str:
    return os.getenv("BETTER_AUTH_JWT_AUDIENCE", "").strip() or DEFAULT_AUDIENCE


def jwks_url() -> str:
    override = os.getenv("BETTER_AUTH_JWKS_URL", "").strip()
    return override or f"{token_issuer()}/api/auth/jwks"


@lru_cache(maxsize=4)
def _jwk_client(url: str) -> jwt.PyJWKClient:
    # Keys are cached; an unknown "kid" (after a key rotation) refetches the set.
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600, timeout=5)


def _signing_key(token: str) -> Any:
    try:
        return _jwk_client(jwks_url()).get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the sign-in service. Try again shortly.",
        ) from exc
    except (jwt.PyJWKClientError, jwt.DecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
        ) from exc


def decode_access_token(token: str) -> dict[str, Any]:
    key = _signing_key(token)
    try:
        return jwt.decode(
            token,
            key,
            algorithms=ALGORITHMS,
            audience=token_audience(),
            issuer=token_issuer(),
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
        ) from exc
