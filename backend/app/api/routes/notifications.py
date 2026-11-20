"""In-app notifications (U5): list, unread count, mark read/unread, delete.

``audience`` splits an account that is both buyer and farm owner: the buyer
site sends ``buyer`` (buyer and admin notifications), the merchant site sends
``merchant``. Left out, every notification is included (older mobile builds).
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.pagination import MAX_OFFSET
from app.services.notifications import MERCHANT

Audience = Literal["buyer", "merchant"]

router = APIRouter(tags=["notifications"])


class NotificationItem(BaseModel):
    id: int
    kind: str
    audience: str
    title: str
    body: str | None
    link: str | None
    read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationList(BaseModel):
    items: list[NotificationItem]
    unread: int
    total: int


def _view(n: Notification) -> NotificationItem:
    return NotificationItem(
        id=n.id,
        kind=n.kind,
        audience=n.audience,
        title=n.title,
        body=n.body,
        link=n.link,
        read=n.read_at is not None,
        created_at=n.created_at,
    )


def _for_audience(q, audience: Audience | None):
    if audience == "merchant":
        return q.filter(Notification.audience == MERCHANT)
    if audience == "buyer":
        return q.filter(Notification.audience != MERCHANT)
    return q


@router.get("/users/me/notifications", response_model=NotificationList)
def my_notifications(
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0, le=MAX_OFFSET),
    unread_only: bool = False,
    audience: Audience | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mine = _for_audience(
        db.query(Notification).filter(Notification.user_id == current_user.id),
        audience,
    )
    unread_q = mine.filter(Notification.read_at.is_(None))
    unread = unread_q.count()
    q = unread_q if unread_only else mine
    # Unread-only: the total is the unread count (the bell polls this often).
    total = unread if unread_only else mine.count()
    rows = (
        q.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return NotificationList(items=[_view(n) for n in rows], unread=unread, total=total)


def _mine(db: Session, user: User, notification_id: int) -> Notification:
    n = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user.id)
        .first()
    )
    if n is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return n


@router.post("/users/me/notifications/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = _mine(db, current_user, notification_id)
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        db.commit()


@router.post("/users/me/notifications/{notification_id}/unread", status_code=204)
def mark_unread(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = _mine(db, current_user, notification_id)
    if n.read_at is not None:
        n.read_at = None
        db.commit()


@router.post("/users/me/notifications/read-all", status_code=204)
def mark_all_read(
    audience: Audience | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _for_audience(
        db.query(Notification).filter(
            Notification.user_id == current_user.id, Notification.read_at.is_(None)
        ),
        audience,
    ).update({Notification.read_at: datetime.now(UTC)}, synchronize_session=False)
    db.commit()


# Registered before the {notification_id} route so "read" is not parsed as an id.
@router.delete("/users/me/notifications/read", status_code=204)
def delete_read(
    audience: Audience | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear every notification the user has already read (on this side)."""
    _for_audience(
        db.query(Notification).filter(
            Notification.user_id == current_user.id, Notification.read_at.is_not(None)
        ),
        audience,
    ).delete(synchronize_session=False)
    db.commit()


@router.delete("/users/me/notifications/{notification_id}", status_code=204)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.delete(_mine(db, current_user, notification_id))
    db.commit()
