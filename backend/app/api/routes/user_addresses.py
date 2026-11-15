"""The signed-in user's saved delivery addresses (/users/me/addresses).

A user has many addresses and at most one default. The first address saved
becomes the default; deleting the default promotes the oldest remaining one.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User
from app.models.user_address import UserAddress
from app.schemas.user_address import (
    UserAddressCreate,
    UserAddressResponse,
    UserAddressUpdate,
)
from app.services.pinned_location import validate_pin

router = APIRouter(tags=["users"])

MAX_ADDRESSES = 10


def _own_address(db: Session, user: User, address_id: int) -> UserAddress:
    address = (
        db.query(UserAddress)
        .filter(UserAddress.id == address_id, UserAddress.user_id == user.id)
        .first()
    )
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    return address


def _clear_default(db: Session, user: User) -> None:
    # Flushed before the new default is set so the one-default index holds.
    db.query(UserAddress).filter(
        UserAddress.user_id == user.id, UserAddress.is_default.is_(True)
    ).update({"is_default": False}, synchronize_session="fetch")
    db.flush()


@router.get("/users/me/addresses", response_model=list[UserAddressResponse])
def list_my_addresses(current_user: User = Depends(get_current_user)):
    return current_user.addresses


@router.post("/users/me/addresses", response_model=UserAddressResponse, status_code=201)
def create_my_address(
    payload: UserAddressCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = db.query(UserAddress).filter(UserAddress.user_id == current_user.id).count()
    if count >= MAX_ADDRESSES:
        raise HTTPException(
            status_code=400,
            detail=f"You can save up to {MAX_ADDRESSES} addresses",
        )
    validate_pin(payload.lat, payload.lng)

    data = payload.model_dump()
    make_default = data.pop("is_default") or count == 0
    if make_default:
        _clear_default(db, current_user)
    address = UserAddress(user_id=current_user.id, is_default=make_default, **data)
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@router.patch("/users/me/addresses/{address_id}", response_model=UserAddressResponse)
def update_my_address(
    address_id: int,
    payload: UserAddressUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    address = _own_address(db, current_user, address_id)
    updates = payload.model_dump(exclude_unset=True)
    make_default = updates.pop("is_default", None)

    if "lat" in updates or "lng" in updates:
        validate_pin(updates.get("lat", address.lat), updates.get("lng", address.lng))
    for field, value in updates.items():
        setattr(address, field, value)

    if make_default and not address.is_default:
        _clear_default(db, current_user)
        address.is_default = True

    db.commit()
    db.refresh(address)
    return address


@router.delete("/users/me/addresses/{address_id}", status_code=204)
def delete_my_address(
    address_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    address = _own_address(db, current_user, address_id)
    was_default = address.is_default
    db.delete(address)
    db.flush()

    if was_default:
        successor = (
            db.query(UserAddress)
            .filter(UserAddress.user_id == current_user.id)
            .order_by(UserAddress.id.asc())
            .first()
        )
        if successor is not None:
            successor.is_default = True
    db.commit()
