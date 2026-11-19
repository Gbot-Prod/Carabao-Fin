import hmac
import os

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionLocal
from app.core.security import verify_access_token
from app.models.user import User
from app.services.account_suspension import suspended_detail
from app.services.auth_identity import Identity, resolve_user

bearer_scheme = HTTPBearer(auto_error=False)

# Clients look for this detail to open the "verify your phone" step and retry.
PHONE_VERIFICATION_REQUIRED = "PHONE_VERIFICATION_REQUIRED"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_internal_secret(
    x_internal_auth_sync_secret: str | None = Header(
        default=None, alias="X-Internal-Auth-Sync-Secret"
    ),
) -> None:
    """Server-to-server calls from the Next.js app (BetterAuth hooks)."""
    expected = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected:
        raise HTTPException(
            status_code=500, detail="AUTH_SYNC_SHARED_SECRET is not configured"
        )
    if not _same_secret(x_internal_auth_sync_secret, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _same_secret(sent: str | None, expected: str) -> bool:
    # CF-0084: compare bytes. compare_digest raises TypeError on a non-ASCII
    # str, and header values can hold any latin-1 character.
    return hmac.compare_digest((sent or "").encode(), expected.encode())


def is_internal_request(request: Request) -> bool:
    """CF-0084: the call comes from our own web server (it holds the shared
    secret), e.g. a server-rendered page. Never raises; False without a secret.
    """
    expected = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected:
        return False
    return _same_secret(request.headers.get("X-Internal-Auth-Sync-Secret"), expected)


def get_current_user(
    db=Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    """The caller's backend row, from a BetterAuth access token (Bearer only)."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    verified = verify_access_token(credentials.credentials)
    claims = verified.claims
    user = resolve_user(db, Identity.from_claims(claims))

    # Read live from BetterAuth: a ban takes effect before the token expires.
    if user.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=suspended_detail(user)
        )
    # CF-0017: only a session that passed the TOTP step carries mfa=true
    # (lib/auth.ts). A Google session or an older session does not.
    user.mfa_session = claims.get("mfa") is True
    # Which web deploy made the token: from the key set that verified it,
    # never from the request (app/core/security.py).
    user.token_surface = verified.surface
    return user


def ensure_phone_verified(user: User) -> None:
    """Checkout, merchant applications and buyers' order chat need a verified
    number. Phone signups verify theirs by code; Google/Facebook signups have
    none, so the app asks for a texted code the first time one of these is
    reached (BetterAuth's phoneNumber plugin)."""
    if not user.phone_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=PHONE_VERIFICATION_REQUIRED
        )


def require_verified_phone(current_user: User = Depends(get_current_user)) -> User:
    ensure_phone_verified(current_user)
    return current_user
