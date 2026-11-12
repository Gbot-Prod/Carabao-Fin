"""The notification bell (U5): list, unread count, mark read."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.notification import Notification
from app.models.user import User

router = APIRouter(tags=["notifications"])


class NotificationItem(BaseModel):
    id: int
    kind: str
    title: str
    body: str | None
    link: str | None
    read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationList(BaseModel):
    items: list[NotificationItem]
    unread: int


def _view(n: Notification) -> NotificationItem:
    return NotificationItem(
        id=n.id,
        kind=n.kind,
        title=n.title,
        body=n.body,
        link=n.link,
        read=n.read_at is not None,
        created_at=n.created_at,
    )


@router.get("/users/me/notifications", response_model=NotificationList)
def my_notifications(
    limit: int = Query(30, ge=1, le=100),
    unread_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mine = db.query(Notification).filter(Notification.user_id == current_user.id)
    unread = mine.filter(Notification.read_at.is_(None)).count()
    q = mine.filter(Notification.read_at.is_(None)) if unread_only else mine
    rows = (
        q.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .all()
    )
    return NotificationList(items=[_view(n) for n in rows], unread=unread)


@router.post("/users/me/notifications/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
        .first()
    )
    if n is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        db.commit()


@router.post("/users/me/notifications/read-all", status_code=204)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id, Notification.read_at.is_(None)
    ).update({Notification.read_at: datetime.now(UTC)}, synchronize_session=False)
    db.commit()
