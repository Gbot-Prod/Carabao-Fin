"""A farm's own voucher codes (CF-0061, B05 slice 2).

Only the signed-in merchant's vouchers are reachable: a voucher of another
farm is 404, the same as a missing one.
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.user import User
from app.models.voucher import Voucher, VoucherRedemption
from app.schemas.voucher import VoucherCreate, VoucherResponse, VoucherUpdate
from app.services import vouchers
from app.services.merchant_service import get_active_merchant

router = APIRouter(tags=["merchant vouchers"])

# A farm runs a few promotions at a time; old ones can be deleted or kept off.
MAX_VOUCHERS_PER_MERCHANT = 50

_FIELDS = (
    "kind",
    "value",
    "min_subtotal",
    "max_discount",
    "usage_limit",
    "per_user_limit",
    "starts_at",
    "expires_at",
    "active",
)


def _merchant(db: Session, user: User) -> Merchant:
    merchant = get_active_merchant(db, cast(int, user.id))
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    return merchant


def _own_voucher(db: Session, merchant: Merchant, voucher_id: int) -> Voucher:
    voucher = (
        db.query(Voucher)
        .filter(Voucher.id == voucher_id, Voucher.merchant_id == merchant.id)
        .first()
    )
    if voucher is None:
        raise HTTPException(status_code=404, detail="Voucher not found")
    return voucher


def _response(db: Session, voucher: Voucher) -> VoucherResponse:
    data: dict[str, Any] = {name: getattr(voucher, name) for name in _FIELDS}
    return VoucherResponse(
        id=cast(int, voucher.id),
        code=cast(str, voucher.code),
        created_at=cast(Any, voucher.created_at),
        uses=vouchers.uses_count(db, cast(int, voucher.id)),
        **data,
    )


@router.get("/merchants/me/vouchers", response_model=list[VoucherResponse])
def list_my_vouchers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[VoucherResponse]:
    merchant = _merchant(db, current_user)
    rows = (
        db.query(Voucher)
        .filter(Voucher.merchant_id == merchant.id)
        .order_by(Voucher.created_at.desc(), Voucher.id.desc())
        .all()
    )
    return [_response(db, row) for row in rows]


@router.post("/merchants/me/vouchers", response_model=VoucherResponse, status_code=201)
def create_my_voucher(
    payload: VoucherCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoucherResponse:
    merchant = _merchant(db, current_user)
    values = payload.model_dump()
    vouchers.check_rules(values)
    count = (
        db.query(func.count(Voucher.id))
        .filter(Voucher.merchant_id == merchant.id)
        .scalar()
    )
    if int(count or 0) >= MAX_VOUCHERS_PER_MERCHANT:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A farm can have at most {MAX_VOUCHERS_PER_MERCHANT} vouchers. "
                "Delete an old one first."
            ),
        )
    code = vouchers.normalize_code(values.pop("code"))
    voucher = Voucher(merchant_id=merchant.id, code=code, **values)
    db.add(voucher)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail=f"You already have a voucher {code}."
        ) from exc
    db.refresh(voucher)
    return _response(db, voucher)


@router.patch("/merchants/me/vouchers/{voucher_id}", response_model=VoucherResponse)
def update_my_voucher(
    voucher_id: int,
    payload: VoucherUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoucherResponse:
    merchant = _merchant(db, current_user)
    voucher = _own_voucher(db, merchant, voucher_id)
    # Only the fields sent change; null clears an optional cap or date.
    changes = payload.model_dump(include=payload.model_fields_set)
    for required in ("kind", "value", "min_subtotal", "per_user_limit", "active"):
        if required in changes and changes[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} cannot be empty.")
    merged = {name: getattr(voucher, name) for name in _FIELDS} | changes
    vouchers.check_rules(merged)
    for name, value in changes.items():
        setattr(voucher, name, value)
    db.commit()
    db.refresh(voucher)
    return _response(db, voucher)


@router.delete("/merchants/me/vouchers/{voucher_id}", status_code=204)
def delete_my_voucher(
    voucher_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    merchant = _merchant(db, current_user)
    voucher = _own_voucher(db, merchant, voucher_id)
    # Redemptions are the record of what each order was discounted by; keep
    # them (and the voucher) once any order used it.
    used = (
        db.query(func.count(VoucherRedemption.id))
        .filter(VoucherRedemption.voucher_id == voucher.id)
        .scalar()
    )
    if int(used or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="This voucher was used on orders. Turn it off instead.",
        )
    db.delete(voucher)
    db.commit()
    return Response(status_code=204)
