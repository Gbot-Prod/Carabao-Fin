"""Reminders for merchants who chose Submit later (status ``setup``).

On days 1, 3, 7 and 14 after the application was created: "Finish your
business information to start selling", by email (``email_alerts``) and SMS
(``order_updates``; the contact number was verified at onboarding), plus an
in-app notification. Runs every minute in the ``main.py`` cleanup loop.

* Each (merchant, day) is recorded in merchant_setup_reminders before the
  message goes out, and the row is unique: never sent twice.
* Only the latest day that is due is sent; a merchant who is days late gets
  one message, not several. Earlier days are recorded as skipped (sent too).
* Reminders stop once the merchant leaves ``setup`` (they submitted).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.urls import merchant_url
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_setup_reminder import MerchantSetupReminder
from app.models.statuses import MerchantVerificationStatus
from app.models.user import User
from app.services import notifications

logger = logging.getLogger(__name__)

REMINDER_DAYS = (1, 3, 7, 14)
SETUP_REMINDER = "setup_reminder"
TITLE = "Finish your business information to start selling"
BUSINESS_STEP_PATH = "/onboarding?step=business"
# The bell's merchant link (notifications.audience_for).
IN_APP_LINK = "/merchantDashboard"


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def due_day(created_at: datetime, sent: set[int], now: datetime) -> int | None:
    """The latest reminder day that has come and was not sent yet."""
    age = now - _aware(created_at)
    due = [day for day in REMINDER_DAYS if age >= timedelta(days=day)]
    if not due or due[-1] in sent:
        return None
    return due[-1]


def _send(user: User | None, merchant: Any, day: int) -> None:
    from app.integrations.sms.semaphore import send_sms
    from app.services import email as email_service

    url = merchant_url(BUSINESS_STEP_PATH)
    name = str(merchant.merchant_name or "Your shop")
    if merchant.contact_email and notifications.wants(user, "email"):
        try:
            email_service.send_setup_reminder_email(
                str(merchant.contact_email), shop_name=name, url=url
            )
        except Exception:  # noqa: BLE001 - one failed channel must not stop the rest
            logger.warning("Setup reminder email failed for merchant %s", merchant.id)
    if merchant.contact_number and notifications.wants(user, "sms"):
        try:
            send_sms(
                number=str(merchant.contact_number),
                message=f"Carabao: {TITLE}. Add it here: {url}",
            )
        except Exception:  # noqa: BLE001
            logger.warning("Setup reminder SMS failed for merchant %s", merchant.id)
    logger.info("Sent day-%s setup reminder to merchant %s", day, merchant.id)


def send_due_reminders(db: Session, now: datetime | None = None) -> int:
    """Send every reminder that is due. Returns how many merchants were reminded.

    Commits per merchant, so a reminder is recorded before its message goes out.
    """
    now = now or datetime.now(UTC)
    rows = (
        db.query(Merchant, MerchantApplication.created_at)
        .join(MerchantApplication, MerchantApplication.merchant_id == Merchant.id)
        .filter(
            Merchant.verification_status == MerchantVerificationStatus.SETUP,
            Merchant.deleted_at.is_(None),
            MerchantApplication.created_at <= now - timedelta(days=REMINDER_DAYS[0]),
        )
        .all()
    )
    reminded = 0
    for merchant, created_at in rows:
        sent = {
            day
            for (day,) in db.query(MerchantSetupReminder.day).filter(
                MerchantSetupReminder.merchant_id == merchant.id
            )
        }
        day = due_day(created_at, sent, now)
        if day is None:
            continue
        # Record this day and any earlier unsent day before sending.
        for earlier in REMINDER_DAYS:
            if earlier <= day and earlier not in sent:
                db.add(MerchantSetupReminder(merchant_id=merchant.id, day=earlier))
        user = db.get(User, merchant.user_id)
        notifications.notify(
            db,
            merchant.user_id,
            SETUP_REMINDER,
            TITLE,
            "Your shop can go live once Carabao reviews your business documents.",
            link=IN_APP_LINK,
        )
        try:
            db.commit()
        except IntegrityError:
            # Another worker recorded it first: it sends, this one does not.
            db.rollback()
            continue
        _send(user, merchant, day)
        reminded += 1
    return reminded
