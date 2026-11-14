"""Who the caller is.

Sign-in, sign-up, sessions, password resets and two-step verification all live
in BetterAuth (the Next.js app, /api/auth/*), for the web and the mobile app
alike. The backend only checks BetterAuth's access tokens (app/core/security.py)
and creates the matching backend row on first use (app/services/auth_identity.py).
Identity fields are read live from BetterAuth's "user" table.
"""

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user
from app.models.user import User

router = APIRouter(tags=["auth"])


@router.get("/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "external_auth_id": current_user.external_auth_id,
        "email": current_user.email,
        "email_verified": current_user.email_verified,
        "name": current_user.name,
        "phone_number": current_user.phone_number,
        "phone_verified": current_user.phone_verified,
        "is_admin": current_user.is_admin,
    }
