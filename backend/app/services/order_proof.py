"""Order proof photos (documentation/plans/ORDER_PROOF_PHOTOS_PLAN.md).

A photo proves each order at packing (``packing``, needed before it ships),
at drop-off (``dropoff``: the merchant sets ``delivered``) and at a failed
drop-off (``attempt``: a cancel from ``out_for_delivery``).

For a drop-off or attempt photo the server records the received time, the
SHA-256 of the file and the distance from the phone to the buyer pin in
metres. The phone's raw position is not stored and not logged. Flags do not
stop the delivery; they hold its payout (payout_service.delivery_payable) and
admins see them:

- ``gps_far``: more than PROOF_GPS_MAX_M metres (default 200) from the pin
- ``gps_missing``: the phone sent no position
- ``pin_missing``: the order has no pin to measure against
- ``hash_reused``: the same file was sent for another order
- ``pin_reported``: the rider reported this order's pin as unreachable
"""

from __future__ import annotations

import logging
import math
import os
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.errors import upstream_error
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.services import r2_service, upload_validation
from app.services.pinned_location import distance_m

logger = logging.getLogger(__name__)

PACKING = "packing"
DROPOFF = "dropoff"
ATTEMPT = "attempt"

GPS_FAR = "gps_far"
GPS_MISSING = "gps_missing"
PIN_MISSING = "pin_missing"
HASH_REUSED = "hash_reused"
PIN_REPORTED = "pin_reported"

# Photo objects are deleted this many days after the order closes.
PHOTO_RETENTION_DAYS = 90
# Rows done per retention run, so one run stays short.
PURGE_BATCH = 200


def gps_max_m() -> int:
    return int(os.getenv("PROOF_GPS_MAX_M", "200"))


def check_position(lat: float | None, lng: float | None) -> tuple[float, float] | None:
    """The phone position, or None when it sent none. 422 when it is half
    sent or not a real place."""
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise HTTPException(status_code=422, detail="Send both lat and lng, or neither")
    if not (math.isfinite(lat) and math.isfinite(lng)):
        raise HTTPException(status_code=422, detail="The position is not valid")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=422, detail="The position is not valid")
    return (lat, lng)


def _buyer_pin(order: Order) -> tuple[float, float] | None:
    if order.delivery_lat is None or order.delivery_lng is None:
        return None
    return (order.delivery_lat, order.delivery_lng)


def _hash_on_other_order(db: Session, order_id: int, sha256: str) -> bool:
    return (
        db.query(OrderProofPhoto.id)
        .filter(OrderProofPhoto.sha256 == sha256, OrderProofPhoto.order_id != order_id)
        .first()
        is not None
    )


def proof_flags(
    db: Session,
    order: Order,
    kind: str,
    sha256: str,
    position: tuple[float, float] | None,
) -> tuple[int | None, list[str]]:
    """(distance to the buyer pin in metres, flags) for a new photo."""
    flags: list[str] = []
    distance: int | None = None
    if kind != PACKING:
        pin = _buyer_pin(order)
        if position is None:
            flags.append(GPS_MISSING)
        elif pin is None:
            flags.append(PIN_MISSING)
        else:
            distance = round(distance_m(position, pin))
            if distance > gps_max_m():
                flags.append(GPS_FAR)
        if order.pin_unreachable_at is not None:
            flags.append(PIN_REPORTED)
    if _hash_on_other_order(db, order.id, sha256):
        flags.append(HASH_REUSED)
    return distance, flags


def get_photo(db: Session, order_id: int, kind: str) -> OrderProofPhoto | None:
    return (
        db.query(OrderProofPhoto)
        .filter(OrderProofPhoto.order_id == order_id, OrderProofPhoto.kind == kind)
        .first()
    )


def has_packing_photo(db: Session, order_ids: list[int]) -> set[int]:
    """The ids in ``order_ids`` that have a packing photo."""
    if not order_ids:
        return set()
    return {
        order_id
        for (order_id,) in db.query(OrderProofPhoto.order_id).filter(
            OrderProofPhoto.order_id.in_(order_ids),
            OrderProofPhoto.kind == PACKING,
        )
    }


def delete_object_quietly(key: str | None) -> None:
    """Remove a stored photo; a failure is only logged (an orphan object)."""
    if not key:
        return
    try:
        r2_service.delete_private_document(key)
    except Exception:  # noqa: BLE001 - best effort clean-up
        logger.warning("Could not delete a proof photo object", exc_info=True)


class StoredPhoto:
    """A photo row written in this request, and the objects to clean up."""

    def __init__(self, row: OrderProofPhoto, new_key: str, replaced_key: str | None):
        self.row = row
        self.new_key = new_key
        self.replaced_key = replaced_key

    @property
    def flags(self) -> list[str]:
        return list(self.row.flags or [])

    def committed(self) -> None:
        """After the commit: the replaced photo (a retaken packing photo) goes."""
        delete_object_quietly(self.replaced_key)

    def failed(self) -> None:
        """The commit failed: the new object is not used by any row."""
        delete_object_quietly(self.new_key)


def store_photo(
    db: Session,
    order: Order,
    kind: str,
    upload: UploadFile,
    user_id: int,
    position: tuple[float, float] | None = None,
) -> StoredPhoto:
    """Check and store the photo, and write (or replace) its row; the caller
    commits, then calls ``committed()`` (or ``failed()`` when it rolls back)."""
    checked, sha256 = upload_validation.check_proof_photo_upload(upload, "Photo")
    distance, flags = proof_flags(db, order, kind, sha256, position)
    try:
        key = r2_service.upload_proof_photo(order.id, kind, checked)
    except Exception as exc:
        raise upstream_error(
            503,
            "Could not save the photo. Try again.",
            log=f"R2 proof photo upload failed for order {order.id}",
            exc=exc,
        ) from exc

    row = get_photo(db, order.id, kind)
    replaced_key = None
    if row is None:
        row = OrderProofPhoto(order_id=order.id, kind=kind)
        db.add(row)
    else:
        replaced_key = row.object_key
    row.object_key = key
    row.sha256 = sha256
    row.content_type = checked.content_type
    row.taken_by_user_id = user_id
    row.received_at = datetime.now(UTC)
    row.distance_m = distance
    row.flags = flags
    row.deleted_at = None
    return StoredPhoto(row, key, replaced_key)


def read_photo(row: OrderProofPhoto) -> bytes:
    """The photo's bytes; 404 once the retention sweep removed it."""
    if not row.object_key or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="This photo was deleted")
    try:
        return r2_service.get_private_document(row.object_key)
    except Exception as exc:
        raise upstream_error(
            502,
            "Could not load the photo. Try again.",
            log=f"R2 proof photo read failed for row {row.id}",
            exc=exc,
        ) from exc


def purge_old_photos(db: Session, now: datetime | None = None) -> int:
    """Delete photo objects of orders closed PHOTO_RETENTION_DAYS ago; keep the
    row (hash, time, distance, flags). Commits after each object, so a row
    never names an object that is gone. Returns how many were deleted."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=PHOTO_RETENTION_DAYS)
    rows = (
        db.query(OrderProofPhoto)
        .join(Order, Order.id == OrderProofPhoto.order_id)
        .filter(
            OrderProofPhoto.object_key.isnot(None),
            Order.closed_at.isnot(None),
            Order.closed_at < cutoff,
        )
        .order_by(OrderProofPhoto.id)
        .limit(PURGE_BATCH)
        .all()
    )
    purged = 0
    for row in rows:
        try:
            r2_service.delete_private_document(row.object_key)
        except Exception:  # noqa: BLE001 - the next run tries again
            logger.warning("Could not delete proof photo %s", row.id, exc_info=True)
            continue
        row.object_key = None
        row.deleted_at = now
        db.commit()
        purged += 1
    return purged
