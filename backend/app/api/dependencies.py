from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.models.user import User


bearer_scheme = HTTPBearer(auto_error=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    request: Request,
    db=Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    token = None

    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials

    if not token:
        token = request.cookies.get("backend_access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token",
        )

    payload = decode_access_token(token)
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token subject",
        )

    user = db.query(User).filter(User.external_auth_id == subject).first()

    if user is None:
        # JWT has embedded claims — auto-provision the backend_users row so a
        # FastAPI crash during the original sync never permanently blocks a user.
        email: str | None = payload.get("email")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
        # Check if the user exists by email (unlinked row from a prior state).
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.external_auth_id = subject
        else:
            user = User(
                external_auth_id=subject,
                email=email,
                first_name=payload.get("first_name"),
                last_name=payload.get("last_name"),
            )
            db.add(user)
        db.commit()
        db.refresh(user)

    return user