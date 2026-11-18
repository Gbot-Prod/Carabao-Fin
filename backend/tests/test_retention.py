"""CF-0056 (B62): old search rows and old read notifications are deleted."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.search_log import SearchLog
from app.models.user import User
from app.services.retention import (
    READ_NOTIFICATION_DAYS,
    SEARCH_LOG_DAYS,
    purge_old_rows,
)
from tests.shared_fixtures import _buyer

NOW = datetime(2026, 11, 18, 4, tzinfo=UTC)


def _search(db: Session, days_ago: int, query: str) -> None:
    db.add(
        SearchLog(
            query=query, result_count=1, created_at=NOW - timedelta(days=days_ago)
        )
    )


def _note(db: Session, user: User, title: str, read_days_ago: int | None) -> None:
    read_at = None if read_days_ago is None else NOW - timedelta(days=read_days_ago)
    db.add(
        Notification(
            user_id=user.id,
            kind="order_paid",
            title=title,
            read_at=read_at,
            created_at=NOW - timedelta(days=400),
        )
    )


def test_purge_keeps_recent_and_unread_rows(db: Session) -> None:
    user, _ = _buyer(db)
    _search(db, SEARCH_LOG_DAYS + 1, "old")
    _search(db, SEARCH_LOG_DAYS - 1, "recent")
    _note(db, user, "old read", READ_NOTIFICATION_DAYS + 1)
    _note(db, user, "recent read", READ_NOTIFICATION_DAYS - 1)
    _note(db, user, "old unread", None)
    db.commit()

    assert purge_old_rows(db, now=NOW) == (1, 1)
    db.commit()

    assert [s.query for s in db.query(SearchLog).all()] == ["recent"]
    titles = sorted(n.title for n in db.query(Notification).all())
    assert titles == ["old unread", "recent read"]
    # Nothing left to delete the second time.
    assert purge_old_rows(db, now=NOW) == (0, 0)


def test_search_window_covers_demand_insight() -> None:
    from app.api.routes.demand_insight import WINDOW_DAYS

    assert SEARCH_LOG_DAYS > WINDOW_DAYS
