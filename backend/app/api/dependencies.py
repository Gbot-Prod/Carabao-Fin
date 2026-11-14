from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.models.user import User
from app.services import better_auth_store
from app.services.account_suspension import suspended_detail
from app.services.auth_identity import Identity, resolve_user

bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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

    if user.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=suspended_detail(user)
        )

    # Two-step verification is admins only (d7a2e4c6f8b1) and gates the admin
    # API, so it is read live from BetterAuth for admins; others stay False.
    if user.is_admin:
        better_auth_store.load_two_factor(db, [user])

    return user
