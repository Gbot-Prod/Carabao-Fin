"""Favourite farms (U4): follow / unfollow and list what you follow."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.farm_follow import FarmFollow
from app.models.merchant import Merchant
from app.models.user import User
from app.services.account_suspension import merchant_is_public

router = APIRouter(tags=["follows"])


@router.get("/users/me/follows", response_model=list[int])
def my_follows(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merchant ids the buyer follows, most recent first."""
    rows = (
        db.query(FarmFollow.merchant_id)
        .filter(FarmFollow.user_id == current_user.id)
        .order_by(FarmFollow.created_at.desc(), FarmFollow.id.desc())
        .all()
    )
    return [merchant_id for (merchant_id,) in rows]


@router.put("/merchants/{merchant_id}/follow", status_code=204)
def follow_farm(
    merchant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = (
        db.query(Merchant)
        .filter(Merchant.id == merchant_id, merchant_is_public())
        .first()
    )
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    if merchant.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't follow your own farm")
    exists = (
        db.query(FarmFollow.id)
        .filter(
            FarmFollow.user_id == current_user.id, FarmFollow.merchant_id == merchant_id
        )
        .first()
    )
    if exists is None:
        db.add(FarmFollow(user_id=current_user.id, merchant_id=merchant_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # a double click raced us; already followed


@router.delete("/merchants/{merchant_id}/follow", status_code=204)
def unfollow_farm(
    merchant_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(FarmFollow).filter(
        FarmFollow.user_id == current_user.id, FarmFollow.merchant_id == merchant_id
    ).delete(synchronize_session=False)
    db.commit()
