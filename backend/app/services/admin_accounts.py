"""Admin accounts: invite, accept, resend, reset, deactivate, reactivate.

A reset (lost authenticator or forgotten password) and a reactivation remove
the password and 2FA and send a new invite, so every way into an admin account
is the same: link + code + new password + TOTP setup.

documentation/manuals/DB_ROLE_SPLIT_PLAN.md section 2. An admin account is
only ever made as an admin account; nobody is promoted. Becoming an admin needs
three things: the invite link (sent by email), the invite code (handed over by
the inviting admin, never emailed) and an authenticator app.

1. ``invite``: the "user" row (role admin, no password), a 24-hour setup token
   (the link) and a 24-hour code. The code is returned to the inviting admin
   once and only its SHA-256 is kept.
2. ``accept``: the link's token + the code + a new password. The 5th wrong code
   ends the invite (code and token both go). On success the password is
   written here, so web-admin's own database login never inserts an
   "account" row.
3. TOTP setup on the admin site, with the same setup token (lib/auth.ts).
   ``record_enrolled`` logs it once the database shows 2FA on.

Every step writes an admin audit row in the same commit as the change.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.errors import describe_error
from app.core.urls import admin_url
from app.models.admin_audit_log import AdminAuditLog
from app.models.auth_identity import AuthIdentity, is_placeholder_email
from app.models.user import User, normalize_email
from app.services import admin_enrolment, audit_log, better_auth_store, rate_limit
from app.services.email import send_admin_invite_email

logger = logging.getLogger(__name__)

INVITE_TTL = admin_enrolment.TOKEN_TTL  # 24 hours, like the setup link
INVITE_PATH = "/admin/invite"
MAX_CODE_ATTEMPTS = 5
DEACTIVATED_REASON = "Admin access removed"

# 8 characters with no look-alikes (no 0/O, no 1/I/L), shown as XXXX-XXXX.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8

# Longer than the site's 8 for everyone else: an admin can release payouts.
# Otherwise the site rule (lib/password-policy.ts).
MIN_ADMIN_PASSWORD = 12
MAX_PASSWORD = 128

EMAIL_TAKEN_DETAIL = (
    "This email already has a Carabao account. Invite a different address."
)
INVALID_EMAIL_DETAIL = "Enter a valid email address."
INVITE_INVALID_DETAIL = (
    "This invite link or code is not valid. Ask an admin to send a new invite."
)
PASSWORD_RULE_DETAIL = (
    f"Use {MIN_ADMIN_PASSWORD} to {MAX_PASSWORD} characters, with an uppercase "
    "letter, a lowercase letter, a number and a symbol."
)
INVITE_NOT_SENT_DETAIL = (
    'The invite was saved, but the email could not be sent. Use "Resend invite" '
    "to try again."
)
NOT_ADMIN_DETAIL = "This is not an admin account."
ALREADY_ACCEPTED_DETAIL = (
    'This admin already accepted the invite. Use "Reset account" instead.'
)
INVITE_PENDING_RESET_DETAIL = (
    'This admin has not accepted the invite yet. Use "Resend invite" instead.'
)
SELF_RESET_DETAIL = "Ask another admin to reset your account."
DEACTIVATED_DETAIL = "This admin account is deactivated. Reactivate it first."
SELF_DEACTIVATE_DETAIL = "You cannot deactivate your own account."
LAST_ADMIN_DETAIL = (
    "This is the last active admin. Invite another admin and let them finish "
    "setup before you deactivate this one."
)
NOT_DEACTIVATED_DETAIL = "This admin account is not deactivated."
ALREADY_DEACTIVATED_DETAIL = "This admin account is already deactivated."


# ── Codes and passwords ─────────────────────────────────────────────────────


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def format_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def normalize_code(raw: str) -> str:
    """What the invitee typed, in the stored form: upper case, no dash or
    spaces."""
    return "".join(ch for ch in raw.upper() if ch not in "- \t")


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def admin_password_ok(password: str) -> bool:
    """The site rule (lib/password-policy.ts isStrongPassword), at 12+."""
    return (
        MIN_ADMIN_PASSWORD <= len(password) <= MAX_PASSWORD
        and any(ch.isupper() for ch in password)
        and any(ch.islower() for ch in password)
        and any(ch.isdecimal() for ch in password)
        and any(not ch.isalnum() and not ch.isspace() for ch in password)
    )


def invite_url(identity_id: str, token: str) -> str:
    return (
        f"{admin_url()}{INVITE_PATH}?invite={quote(identity_id)}&token={quote(token)}"
    )


# ── Helpers ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IssuedInvite:
    user: User
    code: str  # formatted XXXX-XXXX, shown once to the inviting admin
    expires_at: datetime


def _identity(db: Session, user: User) -> AuthIdentity:
    identity = db.get(AuthIdentity, user.external_auth_id) if user else None
    if identity is None:
        raise HTTPException(status_code=404, detail="User not found")
    return identity


def _require_admin_target(db: Session, user: User) -> AuthIdentity:
    identity = _identity(db, user)
    if identity.role != "admin":
        raise HTTPException(status_code=400, detail=NOT_ADMIN_DETAIL)
    return identity


def _issue_invite(db: Session, identity_id: str) -> tuple[str, str, datetime]:
    """A new setup token and code (both replace older ones). Returns
    (token, code, expires_at). The caller commits."""
    token = admin_enrolment.issue_token(db, identity_id)
    code = new_code()
    expires_at = datetime.now(UTC) + INVITE_TTL
    better_auth_store.set_invite_code(
        db, identity_id, code_hash=hash_code(code), expires_at=expires_at
    )
    return token, code, expires_at


def _dev_without_email() -> bool:
    return not os.getenv("RESEND_KEY") and os.getenv("APP_ENV", "").strip().lower() in {
        "development",
        "local",
    }


def _send_invite(email: str, url: str, invited_by: str, *, reset: bool = False) -> None:
    """Email the link. Raises 502 when it could not be sent (the invite is
    already saved; "Resend invite" makes a new link and code)."""
    if _dev_without_email():
        logger.info("[admin-invite] Email not configured. Invite link: %s", url)
        return
    try:
        send_admin_invite_email(
            email, invite_url=url, invited_by=invited_by, reset=reset
        )
    except Exception as exc:  # noqa: BLE001 - any send failure
        logger.warning("Admin invite email failed: %s", describe_error(exc))
        raise HTTPException(status_code=502, detail=INVITE_NOT_SENT_DETAIL) from exc


def _actor_name(admin: User) -> str:
    return admin.name or admin.email or "A Carabao admin"


# ── Invite, resend ──────────────────────────────────────────────────────────


def invite(db: Session, *, actor: User, email: str, name: str) -> IssuedInvite:
    email = normalize_email(email)
    local, _, domain = email.partition("@")
    if not local or "." not in domain or is_placeholder_email(email):
        raise HTTPException(status_code=422, detail=INVALID_EMAIL_DETAIL)
    if better_auth_store.email_taken(db, email):
        raise HTTPException(status_code=409, detail=EMAIL_TAKEN_DETAIL)

    identity_id = better_auth_store.create_admin_invitee(
        db, email=email, name=name.strip()
    )
    user = User(external_auth_id=identity_id, notifications_preferences={})
    db.add(user)
    db.flush()
    token, code, expires_at = _issue_invite(db, identity_id)
    audit_log.record_admin_action(
        db,
        admin=actor,
        action=audit_log.ADMIN_INVITE,
        target_type="user",
        target_id=user.id,
        after={"email": email, "name": name.strip(), "expires_at": expires_at},
    )
    db.commit()
    db.refresh(user)
    _send_invite(email, invite_url(identity_id, token), _actor_name(actor))
    return IssuedInvite(user=user, code=format_code(code), expires_at=expires_at)


def resend(db: Session, *, actor: User, user: User) -> IssuedInvite:
    """A new link and code for an invite not accepted yet; the old ones stop
    working."""
    identity = _require_admin_target(db, user)
    if identity.banned:
        raise HTTPException(status_code=409, detail=DEACTIVATED_DETAIL)
    if better_auth_store.has_credential_account(db, identity.id):
        raise HTTPException(status_code=409, detail=ALREADY_ACCEPTED_DETAIL)
    token, code, expires_at = _issue_invite(db, identity.id)
    audit_log.record_admin_action(
        db,
        admin=actor,
        action=audit_log.ADMIN_INVITE_RESENT,
        target_type="user",
        target_id=user.id,
        after={"expires_at": expires_at},
    )
    db.commit()
    _send_invite(identity.email, invite_url(identity.id, token), _actor_name(actor))
    return IssuedInvite(user=user, code=format_code(code), expires_at=expires_at)


def _wipe_credentials(db: Session, identity_id: str) -> None:
    """Password, TOTP, backup codes, trusted devices, open setup token and
    invite code, and sessions all go. The account is an open invite again."""
    better_auth_store.clear_two_factor(db, identity_id)
    better_auth_store.delete_admin_password(db, identity_id)


def reset_account(db: Session, *, actor: User, user: User) -> IssuedInvite:
    """Lost authenticator, forgotten password or unfinished setup: remove the
    password and 2FA and send a new invite (link by email, code shown to the
    resetting admin). The admin then accepts it like a new invite."""
    if actor.id == user.id:
        raise HTTPException(status_code=400, detail=SELF_RESET_DETAIL)
    identity = _require_admin_target(db, user)
    if identity.banned:
        raise HTTPException(status_code=409, detail=DEACTIVATED_DETAIL)
    if not better_auth_store.has_credential_account(db, identity.id):
        raise HTTPException(status_code=409, detail=INVITE_PENDING_RESET_DETAIL)
    before = {"two_factor_enabled": identity.two_factor_enabled, "password": True}
    _wipe_credentials(db, identity.id)
    token, code, expires_at = _issue_invite(db, identity.id)
    audit_log.record_admin_action(
        db,
        admin=actor,
        action=audit_log.ADMIN_ACCOUNT_RESET,
        target_type="user",
        target_id=user.id,
        before=before,
        after={
            "two_factor_enabled": False,
            "password": False,
            "expires_at": expires_at,
        },
    )
    db.commit()
    db.refresh(user)
    _send_invite(
        identity.email, invite_url(identity.id, token), _actor_name(actor), reset=True
    )
    return IssuedInvite(user=user, code=format_code(code), expires_at=expires_at)


# ── Accept ──────────────────────────────────────────────────────────────────


def _invalid() -> HTTPException:
    # One message for every failure: the response never says which part was wrong.
    return HTTPException(status_code=400, detail=INVITE_INVALID_DETAIL)


def accept(
    db: Session,
    request: Request,
    *,
    invite_id: str,
    token: str,
    code: str,
    password: str,
) -> str:
    """Check the link's token and the code, then write the password.
    Returns the account's email (for the sign-in page)."""
    # Per IP and per invite. Commits, so it comes before anything else.
    rate_limit.enforce(db, request, "admin_invite_accept", invite_id)
    if not admin_password_ok(password):
        raise HTTPException(status_code=422, detail=PASSWORD_RULE_DETAIL)

    now = datetime.now(UTC)
    identity = db.get(AuthIdentity, invite_id)
    if (
        identity is None
        or identity.role != "admin"
        or identity.banned
        # Invite-only: an account that has a password never sets one here. A
        # reset removes the password first (reset_account).
        or better_auth_store.has_credential_account(db, invite_id)
    ):
        raise _invalid()

    # Locked first, so parallel guesses queue on the counter.
    code_row = better_auth_store.verification_row(
        db, better_auth_store.invite_code_identifier(invite_id), lock=True
    )
    token_row = better_auth_store.verification_row(
        db, better_auth_store.enrolment_identifier(invite_id)
    )
    if token_row is None or token_row[1] <= now:
        raise _invalid()
    if not hmac.compare_digest(admin_enrolment.hash_token(token), token_row[0]):
        # Without the link nobody counts against the code, so knowing the
        # invite id alone cannot lock someone else's invite.
        raise _invalid()
    if code_row is None or code_row[1] <= now:
        raise _invalid()

    stored_hash, _, attempts_text = code_row[0].partition(":")
    if not hmac.compare_digest(hash_code(normalize_code(code)), stored_hash):
        attempts = (int(attempts_text) if attempts_text.isdigit() else 0) + 1
        user = db.query(User).filter(User.external_auth_id == invite_id).first()
        if attempts >= MAX_CODE_ATTEMPTS:
            better_auth_store.delete_invite(db, invite_id)
            if user is not None:
                audit_log.record_admin_action(
                    db,
                    admin=user,
                    action=audit_log.ADMIN_INVITE_LOCKED,
                    target_type="user",
                    target_id=user.id,
                    after={"failed_attempts": attempts},
                )
        else:
            better_auth_store.set_invite_code_attempts(
                db, invite_id, code_hash=stored_hash, attempts=attempts
            )
        db.commit()
        raise _invalid()

    user = db.query(User).filter(User.external_auth_id == invite_id).first()
    if user is None:  # every invite makes the backend row too
        raise _invalid()
    better_auth_store.accept_admin_invite(db, invite_id, password=password)
    audit_log.record_admin_action(
        db,
        admin=user,
        action=audit_log.ADMIN_INVITE_ACCEPTED,
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return identity.email


# ── Two-step setup finished ─────────────────────────────────────────────────

# Actions after which the admin has to set up TOTP again.
_SETUP_STARTERS = (
    audit_log.ADMIN_INVITE,
    audit_log.ADMIN_INVITE_RESENT,
    audit_log.TWO_FACTOR_RESET,
    audit_log.ADMIN_ACCOUNT_RESET,
    audit_log.ADMIN_REACTIVATE,
    audit_log.ADMIN_CREATE,
    audit_log.ADMIN_RECOVER,
)


def record_enrolled(db: Session, identity_id: str) -> bool:
    """Log that an admin finished TOTP setup (called by lib/auth.ts after
    /two-factor/verify-totp). Writes only when the database already shows 2FA
    on, so the call cannot fake a completion, and only once per setup."""
    identity = db.get(AuthIdentity, identity_id)
    if identity is None or identity.role != "admin" or not identity.two_factor_enabled:
        return False
    user = db.query(User).filter(User.external_auth_id == identity_id).first()
    if user is None:
        return False
    last = (
        db.query(AdminAuditLog.action)
        .filter(
            AdminAuditLog.target_type == "user",
            AdminAuditLog.target_id == user.id,
            AdminAuditLog.action.in_(
                (*_SETUP_STARTERS, audit_log.ADMIN_TWO_FACTOR_ENROLLED)
            ),
        )
        .order_by(AdminAuditLog.id.desc())
        .first()
    )
    if last is not None and last[0] == audit_log.ADMIN_TWO_FACTOR_ENROLLED:
        return False
    audit_log.record_admin_action(
        db,
        admin=user,
        action=audit_log.ADMIN_TWO_FACTOR_ENROLLED,
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return True


# ── Deactivate, reactivate ──────────────────────────────────────────────────


def deactivate(db: Session, *, actor: User, user: User) -> User:
    """Admin access removed: banned with the role kept, 2FA, trusted devices,
    setup token, invite code and sessions cleared. Refused for yourself and
    for the last admin who can sign in."""
    if actor.id == user.id:
        raise HTTPException(status_code=400, detail=SELF_DEACTIVATE_DETAIL)
    identity = _require_admin_target(db, user)
    # Locks the active admins first, so the count below cannot race another
    # deactivation.
    active = better_auth_store.lock_active_admins(db)
    db.refresh(identity)
    if identity.banned:
        raise HTTPException(status_code=409, detail=ALREADY_DEACTIVATED_DETAIL)
    if not [admin_id for admin_id in active if admin_id != identity.id]:
        raise HTTPException(status_code=409, detail=LAST_ADMIN_DETAIL)

    before = {"is_deactivated": False, "two_factor_enabled": user.two_factor_enabled}
    better_auth_store.set_banned(
        db, identity.id, banned=True, reason=DEACTIVATED_REASON
    )
    better_auth_store.clear_two_factor(db, identity.id)
    audit_log.record_admin_action(
        db,
        admin=actor,
        action=audit_log.ADMIN_DEACTIVATE,
        target_type="user",
        target_id=user.id,
        before=before,
        after={"is_deactivated": True, "two_factor_enabled": False},
    )
    db.commit()
    db.refresh(user)
    return user


def reactivate(db: Session, *, actor: User, user: User) -> IssuedInvite:
    """Access back, always through a new invite: any old password and 2FA are
    removed (like reset_account), so the admin sets both again."""
    if actor.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot reactivate yourself.")
    identity = _require_admin_target(db, user)
    if not identity.banned:
        raise HTTPException(status_code=409, detail=NOT_DEACTIVATED_DETAIL)
    had_password = better_auth_store.has_credential_account(db, identity.id)

    better_auth_store.set_banned(db, identity.id, banned=False, reason=None)
    _wipe_credentials(db, identity.id)
    token, code, expires_at = _issue_invite(db, identity.id)
    audit_log.record_admin_action(
        db,
        admin=actor,
        action=audit_log.ADMIN_REACTIVATE,
        target_type="user",
        target_id=user.id,
        before={"is_deactivated": True, "password": had_password},
        after={"is_deactivated": False, "password": False, "next_step": "invite"},
    )
    db.commit()
    db.refresh(user)
    _send_invite(
        identity.email,
        invite_url(identity.id, token),
        _actor_name(actor),
        reset=had_password,
    )
    return IssuedInvite(user=user, code=format_code(code), expires_at=expires_at)
