"""The signed-in user's saved delivery addresses (/users/me/addresses).

A user has many addresses and at most one default. The first address saved
becomes the default; deleting the default promotes the oldest remaining one.

Region, province, city and barangay are checked against the PSGC and must be
in Luzon (services/psgc.py). An address may have no area at all (pin only).
The pin is compared with the city and barangay polygons (services/pin_area.py).
Writes are rate limited (``address_write``), and each change to the pin or the
area is logged without coordinates or text (services/address_log.py).
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
from app.services import address_log, pin_area, psgc, rate_limit
from app.services.pinned_location import apply_pin, pin_update, validate_pin

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


def _area_columns(db: Session, values: dict, postal_code: object) -> dict:
    """The eight area columns and the postal code to store, or 400/503."""
    try:
        area = psgc.resolve_area(db, values) if psgc.has_area(values) else None
        postal = psgc.check_postal_code(postal_code, area)  # type: ignore[arg-type]
    except (psgc.AreaError, psgc.AreaListMissing) as exc:
        raise psgc.http_error(exc) from exc
    columns = (
        area.columns()
        if area is not None
        else dict.fromkeys((*psgc.AREA_FIELDS, *psgc.CODE_FIELDS))
    )
    return {**columns, "postal_code": postal}


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
    rate_limit.enforce_action(db, "address_write", str(current_user.id))
    count = db.query(UserAddress).filter(UserAddress.user_id == current_user.id).count()
    if count >= MAX_ADDRESSES:
        raise HTTPException(
            status_code=400,
            detail=f"You can save up to {MAX_ADDRESSES} addresses",
        )
    pin = validate_pin(payload.lat, payload.lng)

    data = payload.model_dump()
    area_values = {f: data.pop(f) for f in (*psgc.AREA_FIELDS, *psgc.CODE_FIELDS)}
    data.update(_area_columns(db, area_values, data.pop("postal_code")))
    confirmed = data.pop("pin_confirmed")
    make_default = data.pop("is_default") or count == 0
    if make_default:
        _clear_default(db, current_user)
    address = UserAddress(user_id=current_user.id, is_default=make_default, **data)
    apply_pin(address, pin, confirmed=confirmed)
    pin_area.apply(db, address, kind="user_address")
    db.add(address)
    db.flush()
    address_log.record(
        db,
        user_id=current_user.id,
        target_type="user_address",
        target_id=address.id,
        action="create",
        before=None,
        after=address_log.snapshot(address),
    )
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
    rate_limit.enforce_action(db, "address_write", str(current_user.id))
    address = _own_address(db, current_user, address_id)
    before = address_log.snapshot(address)
    updates = payload.model_dump(exclude_unset=True)
    make_default = updates.pop("is_default", None)

    area_keys = (*psgc.AREA_FIELDS, *psgc.CODE_FIELDS)
    area_changed = any(key in updates for key in (*area_keys, "postal_code"))
    if area_changed:
        values = psgc.merged_area_values(address, updates)
        postal = updates.get("postal_code", address.postal_code)
        for key in area_keys:
            updates.pop(key, None)
        updates.update(_area_columns(db, values, postal))

    pin_changed = pin_update(address, updates)
    for field, value in updates.items():
        setattr(address, field, value)
    if area_changed or pin_changed:
        pin_area.apply(db, address, kind="user_address")

    if make_default and not address.is_default:
        _clear_default(db, current_user)
        address.is_default = True

    address_log.record(
        db,
        user_id=current_user.id,
        target_type="user_address",
        target_id=address.id,
        action="update",
        before=before,
        after=address_log.snapshot(address),
    )
    db.commit()
    db.refresh(address)
    return address


@router.delete("/users/me/addresses/{address_id}", status_code=204)
def delete_my_address(
    address_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "address_write", str(current_user.id))
    address = _own_address(db, current_user, address_id)
    was_default = address.is_default
    address_log.record(
        db,
        user_id=current_user.id,
        target_type="user_address",
        target_id=address.id,
        action="delete",
        before=address_log.snapshot(address),
        after=None,
    )
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
