"""Delete rows that are no longer read anywhere (CF-0056, B62).

Runs in the ``main.py`` cleanup loop with the OTP / rate-limit purge.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session

from app.models.notification import Notification
from app.models.search_log import SearchLog

# Demand insight reads the last 30 days of searches (demand_insight.WINDOW_DAYS);
# 90 keeps room for a longer window later.
SEARCH_LOG_DAYS = 90
# Read notifications only fill the history list; unread ones are always kept.
READ_NOTIFICATION_DAYS = 180


def _before(column: Any, cutoff: datetime) -> ColumnElement[bool]:
    # The models use untyped Column(), so `column < x` types as bool.
    clause: ColumnElement[bool] = column < cutoff
    return clause


def purge_old_rows(db: Session, now: datetime | None = None) -> tuple[int, int]:
    """Delete old search_log rows and old *read* notifications; the caller commits.

    Returns (search rows, notifications) deleted.
    """
    now = now or datetime.now(UTC)
    searches = (
        db.query(SearchLog)
        .filter(_before(SearchLog.created_at, now - timedelta(days=SEARCH_LOG_DAYS)))
        .delete(synchronize_session=False)
    )
    notes = (
        db.query(Notification)
        .filter(
            Notification.read_at.is_not(None),
            _before(Notification.read_at, now - timedelta(days=READ_NOTIFICATION_DAYS)),
        )
        .delete(synchronize_session=False)
    )
    return searches, notes
