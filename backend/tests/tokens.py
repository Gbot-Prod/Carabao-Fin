"""BetterAuth-style access tokens for tests.

Signs EdDSA tokens with a key made for the test run and points
app.core.security at its public half, the way the real app trusts the keys at
/api/auth/jwks.
"""

from __future__ import annotations

import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import security

ISSUER = "http://web.test"
AUDIENCE = "carabao-api"
KEY = Ed25519PrivateKey.generate()
# The real lookup (via the JWKS client), for tests that exercise it.
REAL_SIGNING_KEY = security._signing_key


def trust_test_key(monkeypatch) -> None:
    monkeypatch.setenv("BETTER_AUTH_URL", ISSUER)
    monkeypatch.delenv("BETTER_AUTH_JWT_AUDIENCE", raising=False)
    monkeypatch.setattr(security, "_signing_key", lambda _token: KEY.public_key())


def make_token(
    sub: str = "ba_user",
    email: str = "user@example.com",
    *,
    key: Any = None,
    algorithm: str = "EdDSA",
    ttl: int = 900,
    **claims: Any,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "email": email,
        "emailVerified": True,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + ttl,
    }
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, key or KEY, algorithm=algorithm)


def bearer(token: str | None = None, **kwargs: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {token or make_token(**kwargs)}"}
