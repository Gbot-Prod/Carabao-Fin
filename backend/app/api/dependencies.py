import hmac
import os

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionLocal
from app.core.security import decode_access_token
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
    if not hmac.compare_digest(x_internal_auth_sync_secret or "", expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


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

    claims = decode_access_token(credentials.credentials)
    user = resolve_user(db, Identity.from_claims(claims))

    # Read live from BetterAuth: a ban takes effect before the token expires.
    if user.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=suspended_detail(user)
        )
    return user


def ensure_phone_verified(user: User) -> None:
    """Checkout, merchant applications and buyers' order chat need a verified
    number. Signups don't verify one (web phone signups give an unverified
    number; Google/Facebook sign-ins have none), so the app asks for a texted
    code the first time one of these is reached (BetterAuth's phoneNumber plugin)."""
    if not user.phone_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=PHONE_VERIFICATION_REQUIRED
        )


def require_verified_phone(current_user: User = Depends(get_current_user)) -> User:
    ensure_phone_verified(current_user)
    return current_user
