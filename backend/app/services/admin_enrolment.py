"""Admin two-step verification setup links (CF-0018).

A password or a session alone must not be enough to set up an admin's
authenticator, because then whoever has them could enrol their own. So setup
needs a one-time token that only an admin action makes: promoting a user, or
resetting an admin's 2FA. The link goes by SMS to the verified number and by
email to the verified address. A token is only made by an admin action, so a
person who changes the account's number or email does not get one.

The token's SHA-256 is kept in BetterAuth's "verification" table
(better_auth_store.set_enrolment_token); lib/auth.ts checks it on
/two-factor/enable and deletes it when setup finishes.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.security import token_issuer
from app.integrations.sms.semaphore import send_sms
from app.models.user import User
from app.services import better_auth_store
from app.services.email import send_admin_enrolment_email

logger = logging.getLogger(__name__)

TOKEN_TTL = timedelta(hours=24)
SETUP_PATH = "/two-factor/enrol"

NO_CONTACT_DETAIL = (
    "This account needs a verified mobile number or email first. The two-step "
    "setup link is sent there."
)
NOT_SENT_DETAIL = (
    'The change was saved, but the setup link could not be sent. Use "Send new '
    'setup link" to try again.'
)

_SMS = (
    "Carabao: your account is now an admin account. Sign in on the website and "
    "set up two-step verification within 24 hours: {url} . Do not share this "
    "link. If you did not expect this, contact support."
)


def hash_token(token: str) -> str:
    """Keep in step with lib/admin-two-factor.ts hashEnrolmentToken()."""
    return hashlib.sha256(token.encode()).hexdigest()


def require_contact(user: User) -> None:
    if not (user.phone_verified or user.verified_email):
        raise HTTPException(status_code=400, detail=NO_CONTACT_DETAIL)


def issue(db: Session, user: User) -> str:
    """Make a new setup token for ``user`` (replaces an older one). The
    caller commits, then calls ``deliver``."""
    require_contact(user)
    token = secrets.token_urlsafe(32)
    better_auth_store.set_enrolment_token(
        db,
        user.external_auth_id,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + TOKEN_TTL,
    )
    return token


def setup_url(token: str) -> str:
    return f"{token_issuer()}{SETUP_PATH}?token={quote(token)}"


def deliver(user: User, token: str) -> list[str]:
    """Send the link by SMS and email. Returns the channels that worked;
    raises 502 if none did."""
    url = setup_url(token)
    sent: list[str] = []
    if user.phone_verified:
        try:
            send_sms(number=user.phone_number, message=_SMS.format(url=url))
            sent.append("sms")
        except Exception as exc:  # noqa: BLE001 - any send failure
            logger.warning("Admin setup SMS failed for user %s: %s", user.id, exc)
    if user.verified_email:
        try:
            send_admin_enrolment_email(user.verified_email, url)
            sent.append("email")
        except Exception as exc:  # noqa: BLE001 - any send failure
            logger.warning("Admin setup email failed for user %s: %s", user.id, exc)
    if not sent:
        raise HTTPException(status_code=502, detail=NOT_SENT_DETAIL)
    return sent
