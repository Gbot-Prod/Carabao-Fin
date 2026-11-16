"""BetterAuth-style access tokens for tests.

Signs EdDSA tokens with keys made for the test run and points
app.core.security at their public halves, the way the real app trusts the keys
at /api/auth/jwks: KEY for the public web deploy, ADMIN_KEY for the admin
deploy (jwks_admin). The "kid" header picks the set.
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
ADMIN_KEY = Ed25519PrivateKey.generate()
PUBLIC_KID = "test-public-key"
ADMIN_KID = "test-admin-key"
# The real lookup (via the JWKS clients), for tests that exercise it.
REAL_SIGNING_KEY = security._signing_key


def _test_signing_key(token: str) -> security.SigningKey:
    if jwt.get_unverified_header(token).get("kid") == ADMIN_KID:
        return security.SigningKey(ADMIN_KEY.public_key(), security.ADMIN_SURFACE)
    return security.SigningKey(KEY.public_key(), security.PUBLIC_SURFACE)


def trust_test_key(monkeypatch) -> None:
    monkeypatch.setenv("BETTER_AUTH_URL", ISSUER)
    monkeypatch.delenv("AUTH_JWT_ISSUER", raising=False)
    monkeypatch.delenv("BETTER_AUTH_JWT_AUDIENCE", raising=False)
    monkeypatch.setattr(security, "_signing_key", _test_signing_key)


def make_token(
    sub: str = "ba_user",
    email: str = "user@example.com",
    *,
    key: Any = None,
    kid: str | None = None,
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
    if kid is None:
        kid = ADMIN_KID if key is ADMIN_KEY else PUBLIC_KID
    return jwt.encode(payload, key or KEY, algorithm=algorithm, headers={"kid": kid})


def make_admin_token(
    sub: str = "ba_user", email: str = "user@example.com", **claims: Any
) -> str:
    """A token from the admin web deploy (signed with the admin key set)."""
    return make_token(sub, email, key=ADMIN_KEY, **claims)


def bearer(token: str | None = None, **kwargs: Any) -> dict[str, str]:
    return {"Authorization": f"Bearer {token or make_token(**kwargs)}"}
