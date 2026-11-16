"""Make the first admin, or recover when no admin can sign in (CF-0018).

Admins are normally made by another admin (PATCH /admin/users/{id}/role). This
script is for the server only. It gives an account the admin role, turns off
any old 2FA, ends its sessions and makes a one-time setup link (24 hours) for
the admin site. The link is printed here, not sent. Each run is in the admin
audit log with the actor "system".

Promote an account (found by its verified mobile number or email):

    uv run python scripts/make_admin.py +639171234567
    uv run python scripts/make_admin.py admin@example.com

Create an email + password account and make it an admin (asks for the
password; it is never an argument, so it is not in the shell history):

    uv run python scripts/make_admin.py --create --email admin@example.com

The admin site signs in with email + password only, so an admin needs a
verified email. With --create the email is marked verified.
"""

import argparse
import getpass
import importlib
import pkgutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import HTTPException  # noqa: E402

# Every model, so relationships by name (User -> "Merchant") resolve.
import app.models as models_pkg  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.auth_identity import AuthIdentity  # noqa: E402
from app.models.user import User, normalize_email  # noqa: E402
from app.services import admin_enrolment, audit_log, better_auth_store  # noqa: E402
from app.services.auth_identity import Identity, resolve_user  # noqa: E402
from app.services.phone_verification import normalize_ph_mobile  # noqa: E402

for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"{models_pkg.__name__}.{_module.name}")

# Longer than the site's 8 for everyone else: this account can release payouts.
MIN_ADMIN_PASSWORD = 12
MAX_PASSWORD = 128  # Better Auth's maximum


def _find_identity(db, contact: str) -> AuthIdentity | None:
    if "@" in contact:
        return (
            db.query(AuthIdentity)
            .filter(AuthIdentity.email == normalize_email(contact))
            .first()
        )
    number = normalize_ph_mobile(contact)  # "639XXXXXXXXX"
    if not number:
        return None
    # BetterAuth stores "+639XXXXXXXXX" (lib/phone.ts normalizePhMobile).
    return (
        db.query(AuthIdentity).filter(AuthIdentity.phone_number == f"+{number}").first()
    )


def _ask_password() -> str:
    """Asked twice, without echo."""
    if not sys.stdin.isatty():
        sys.exit("--create needs a terminal to ask for the password.")
    password = getpass.getpass(
        f"Password for the new admin ({MIN_ADMIN_PASSWORD}+ characters): "
    )
    if not MIN_ADMIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        sys.exit(f"Use {MIN_ADMIN_PASSWORD} to {MAX_PASSWORD} characters.")
    if getpass.getpass("Same password again: ") != password:
        sys.exit("The passwords are not the same.")
    return password


def make_admin(db, identity: AuthIdentity, *, created: bool) -> str:
    """Admin role, old 2FA off, sessions ended, setup link. Logged with the
    "system" actor in the same commit. Returns the setup link token."""
    user: User = resolve_user(db, Identity(subject=identity.id))
    try:
        admin_enrolment.require_contact(user)
    except HTTPException as exc:
        sys.exit(exc.detail)
    was_admin = user.is_admin
    better_auth_store.set_role(db, identity.id, is_admin=True)
    better_auth_store.clear_two_factor(db, identity.id)
    token = admin_enrolment.issue(db, user)
    audit_log.record_system_action(
        db,
        action=audit_log.ROLE_CHANGE,
        target_type="user",
        target_id=user.id,
        before=None if created else {"is_admin": was_admin},
        after={"is_admin": True, "created": created, "via": "scripts/make_admin.py"},
    )
    db.commit()
    return token


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("contact", nargs="?", help="verified mobile number or email")
    parser.add_argument(
        "--create", action="store_true", help="create an email + password account"
    )
    parser.add_argument("--email", help="email of the account to create (--create)")
    parser.add_argument("--name", default="", help="display name (--create)")
    args = parser.parse_args()

    if args.create == bool(args.contact):
        parser.error("give a number or email to promote, or --create --email ...")
    if args.create and not args.email:
        parser.error("--create needs --email")

    db = SessionLocal()
    try:
        if args.create:
            email = normalize_email(args.email)
            if "@" not in email:
                sys.exit("That is not an email address.")
            identity = _find_identity(db, email)
            created = identity is None
            if created:
                password = _ask_password()
                identity_id = better_auth_store.create_email_identity(
                    db, email=email, name=args.name.strip(), password=password
                )
                identity = db.get(AuthIdentity, identity_id)
            else:
                print(
                    f"{email} already has an account. It is promoted; "
                    "its password does not change."
                )
            contact = email
        else:
            contact = args.contact.strip()
            identity = _find_identity(db, contact)
            if identity is None:
                sys.exit(
                    "No account has that number or email. "
                    "Sign up first, or use --create."
                )
            created = False

        if identity is not None and not identity.email_verified:
            print(
                "Note: this account has no verified email. The admin site signs in "
                "with email + password only, so add and verify an email first."
            )
        token = make_admin(db, identity, created=created)
        print(f"{contact} is now an admin. All its sessions were ended.")
        print("Sign in on the admin site, then open this link (one time, 24 hours):")
        print(admin_enrolment.setup_url(token))
    finally:
        db.close()


if __name__ == "__main__":
    main()
