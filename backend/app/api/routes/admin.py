from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant_application import MerchantApplication
from app.models.user import User
from app.schemas.merchant_application import MerchantApplicationResponse
from app.schemas.user import UserResponse

router = APIRouter(tags=["admin"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


@router.get("/admin/users", response_model=list[UserResponse])
def list_all_users(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return db.query(User).order_by(User.id.asc()).all()


@router.get("/admin/merchant-applications", response_model=list[MerchantApplicationResponse])
def list_all_merchant_applications(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return (
        db.query(MerchantApplication)
        .order_by(MerchantApplication.submitted_at.desc())
        .all()
    )
