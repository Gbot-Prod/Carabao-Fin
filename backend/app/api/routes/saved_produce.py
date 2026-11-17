"""Saved produce (wishlist, CF-0038): save / unsave listings and list them."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.saved_produce import SavedProduce
from app.models.user import User
from app.schemas.produce import ProduceResponse, SavedProduceResponse
from app.services.account_suspension import merchant_is_public
from app.services.produce_freshness import is_listed, ph_today

router = APIRouter(tags=["saved produce"])

# Keeps one account's list (and the list query) bounded.
MAX_SAVED = 200


def _orderable(db: Session) -> Query[Produce]:
    """Listings a buyer can see now: listed, from a public merchant."""
    return (
        db.query(Produce)
        .join(Merchant, Merchant.id == Produce.merchant_id)
        .filter(merchant_is_public(), is_listed(ph_today()))  # type: ignore[no-untyped-call]
    )


@router.get("/users/me/saved-produce/ids", response_model=list[int])
def my_saved_produce_ids(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[int]:
    """Produce ids the buyer saved, most recent first (for the heart icons)."""
    rows: list[tuple[int]] = (
        db.query(SavedProduce.produce_id)
        .filter(SavedProduce.user_id == current_user.id)
        .order_by(SavedProduce.created_at.desc(), SavedProduce.id.desc())
        .all()
    )
    return [produce_id for (produce_id,) in rows]


@router.get("/users/me/saved-produce", response_model=list[SavedProduceResponse])
def my_saved_produce(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Saved listings a buyer can order now, most recently saved first.

    Hidden, expired and suspended-farm listings are left out but stay saved.
    """
    rows = (
        _orderable(db)
        .join(SavedProduce, SavedProduce.produce_id == Produce.id)
        .filter(SavedProduce.user_id == current_user.id)
        .add_columns(
            Merchant.merchant_name,
            Merchant.province,
            Merchant.city,
            SavedProduce.created_at,
        )
        .order_by(SavedProduce.created_at.desc(), SavedProduce.id.desc())
        .all()
    )
    return [
        {
            **ProduceResponse.model_validate(produce).model_dump(),
            "merchant_name": merchant_name,
            "merchant_province": province,
            "merchant_city": city,
            "saved_at": saved_at,
        }
        for produce, merchant_name, province, city, saved_at in rows
    ]


@router.put("/produce/{produce_id}/save", status_code=204)
def save_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    produce = _orderable(db).filter(Produce.id == produce_id).first()
    if produce is None:
        raise HTTPException(status_code=404, detail="Produce item not found")
    if produce.merchant.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't save your own listing")
    already = (
        db.query(SavedProduce.id)
        .filter(
            SavedProduce.user_id == current_user.id,
            SavedProduce.produce_id == produce_id,
        )
        .first()
    )
    if already is not None:
        return
    count = (
        db.query(SavedProduce.id)
        .filter(SavedProduce.user_id == current_user.id)
        .count()
    )
    if count >= MAX_SAVED:
        raise HTTPException(
            status_code=400,
            detail=f"You can save up to {MAX_SAVED} items. Remove some first.",
        )
    db.add(SavedProduce(user_id=current_user.id, produce_id=produce_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # a double click raced us; already saved


@router.delete("/produce/{produce_id}/save", status_code=204)
def unsave_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    db.query(SavedProduce).filter(
        SavedProduce.user_id == current_user.id,
        SavedProduce.produce_id == produce_id,
    ).delete(synchronize_session=False)
    db.commit()
