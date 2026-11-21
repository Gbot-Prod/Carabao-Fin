"""Submit later reminders: days 1, 3, 7 and 14; never twice; stop on submit;
email and SMS respect the account's notification preferences."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.merchant_application import MerchantApplication
from app.models.merchant_setup_reminder import MerchantSetupReminder
from app.models.notification import Notification
from app.models.user import User
from app.services import email as email_service
from app.services import setup_reminders
from tests.test_onboarding_seller_types import (  # noqa: F401 - fixtures
    _env,
    _later,
    _submit,
    applicant,
)


@pytest.fixture
def sent(monkeypatch):
    calls: dict[str, list] = {"email": [], "sms": []}
    monkeypatch.setattr(
        email_service,
        "send_setup_reminder_email",
        lambda to, **kw: calls["email"].append((to, kw)),
    )
    import app.integrations.sms.semaphore as semaphore

    monkeypatch.setattr(semaphore, "send_sms", lambda **kw: calls["sms"].append(kw))
    return calls


def _created(db) -> datetime:
    created = db.query(MerchantApplication).one().created_at
    return created if created.tzinfo else created.replace(tzinfo=UTC)


def _days(db) -> list[int]:
    return sorted(day for (day,) in db.query(MerchantSetupReminder.day))


@pytest.mark.parametrize(
    ("age_days", "expected"),
    [(0.5, None), (1, 1), (2, 1), (3, 3), (6, 3), (7, 7), (14, 14), (40, 14)],
)
def test_due_day(age_days, expected) -> None:
    now = datetime(2026, 11, 21, tzinfo=UTC)
    created = now - timedelta(days=age_days)
    assert setup_reminders.due_day(created, set(), now) == expected


def test_reminders_on_days_1_3_7_14_once_each(db, applicant, sent):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    start = _created(db)

    assert setup_reminders.send_due_reminders(db, start + timedelta(hours=12)) == 0
    for day in (1, 3, 7, 14):
        now = start + timedelta(days=day, minutes=1)
        assert setup_reminders.send_due_reminders(db, now) == 1
        # Running again (every minute) sends nothing more.
        assert setup_reminders.send_due_reminders(db, now) == 0
    assert _days(db) == [1, 3, 7, 14]
    assert len(sent["email"]) == 4
    assert len(sent["sms"]) == 4
    assert "onboarding?step=business" in sent["email"][0][1]["url"]
    assert "Finish your business information" in sent["sms"][0]["message"]
    assert db.query(Notification).filter_by(kind="setup_reminder").count() == 4
    assert setup_reminders.send_due_reminders(db, start + timedelta(days=60)) == 0


def test_a_late_merchant_gets_one_message(db, applicant, sent):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    now = _created(db) + timedelta(days=8)
    assert setup_reminders.send_due_reminders(db, now) == 1
    assert len(sent["email"]) == 1
    assert _days(db) == [1, 3, 7]


def test_reminders_stop_after_submitting(db, applicant, sent):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    start = _created(db)
    assert setup_reminders.send_due_reminders(db, start + timedelta(days=1)) == 1
    assert _submit(db, applicant).status_code == 200
    assert setup_reminders.send_due_reminders(db, start + timedelta(days=3)) == 0
    assert len(sent["email"]) == 1


def test_reminders_respect_opt_out(db, applicant, sent):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    user = db.get(User, applicant.id)
    user.notifications_preferences = {"email_alerts": False, "order_updates": False}
    db.commit()
    now = _created(db) + timedelta(days=1)
    assert setup_reminders.send_due_reminders(db, now) == 1
    assert sent == {"email": [], "sms": []}
    # The in-app record is always kept (notifications.py).
    assert db.query(Notification).filter_by(kind="setup_reminder").count() == 1
