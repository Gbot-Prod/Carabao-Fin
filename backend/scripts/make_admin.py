"""Make the first admin, or recover when no admin can sign in (CF-0018).

Admins are normally invited by another admin on the admin site (Users page,
"Invite admin"). This script is for the API service shell only, run as the
API's database login. It never promotes an existing account: buyer and admin
accounts never share an email. Each run is in the admin audit log with the
actor "system". Setup links are printed here, not sent.

Create a new admin with email + password (asks for the password twice; it is
never an argument, so it is not in the shell history):

    uv run python scripts/make_admin.py --create --email admin@example.com         --name "Ana Cruz"

Recover an existing admin account (break glass): clears its 2FA, any
deactivation and all its sessions, then prints a new setup link. If the
account never accepted its invite, it also asks for a password:

    uv run python scripts/make_admin.py --recover admin@example.com
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

# Every model, so relationships by name (User -> "Merchant") resolve.
import app.models as models_pkg  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.auth_identity import AuthIdentity, is_placeholder_email  # noqa: E402
from app.models.user import User, normalize_email  # noqa: E402
from app.services import (  # noqa: E402
    admin_accounts,
    admin_enrolment,
    audit_log,
    better_auth_store,
)

for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"{models_pkg.__name__}.{_module.name}")

MIN_ADMIN_PASSWORD = admin_accounts.MIN_ADMIN_PASSWORD
MAX_PASSWORD = admin_accounts.MAX_PASSWORD
VIA = "scripts/make_admin.py"


def _ask_password() -> str:
    """Asked twice, without echo."""
    if not sys.stdin.isatty():
        sys.exit("This needs a terminal to ask for the password.")
    password = getpass.getpass(
        f"Password for the admin ({MIN_ADMIN_PASSWORD}+ characters, with upper "
        "and lower case, a number and a symbol): "
    )
    if not admin_accounts.admin_password_ok(password):
        sys.exit(admin_accounts.PASSWORD_RULE_DETAIL)
    if getpass.getpass("Same password again: ") != password:
        sys.exit("The passwords are not the same.")
    return password


def _backend_user(db, identity_id: str) -> User:
    user = db.query(User).filter(User.external_auth_id == identity_id).first()
    if user is None:
        user = User(external_auth_id=identity_id, notifications_preferences={})
        db.add(user)
        db.flush()
    return user


def create_admin(db, *, email: str, name: str, password: str) -> str:
    """A new admin account with email + password, and its setup link token.
    Refused when the email already has any account."""
    email = normalize_email(email)
    if "@" not in email or is_placeholder_email(email):
        sys.exit("That is not an email address.")
    if better_auth_store.email_taken(db, email):
        sys.exit(
            f"{email} already has a Carabao account. Admin accounts are separate: "
            "use a different address, or --recover if it is already an admin."
        )
    identity_id = better_auth_store.create_admin_with_password(
        db, email=email, name=name.strip(), password=password
    )
    user = _backend_user(db, identity_id)
    token = admin_enrolment.issue_token(db, identity_id)
    audit_log.record_system_action(
        db,
        action=audit_log.ADMIN_CREATE,
        target_type="user",
        target_id=user.id,
        after={"email": email, "via": VIA},
    )
    db.commit()
    return token


def recover_admin(db, identity: AuthIdentity, *, password: str | None) -> str:
    """Clear 2FA, any deactivation and all sessions of an existing admin, and
    make a new setup link. ``password`` is required when the account has none
    (an invite never accepted)."""
    if identity.role != "admin":
        sys.exit(
            "That account is not an admin account. Admins are never promoted: "
            "use --create with a different email."
        )
    has_password = better_auth_store.has_credential_account(db, identity.id)
    if not has_password and password is None:
        raise ValueError("a password is needed")
    user = _backend_user(db, identity.id)
    before = {
        "is_deactivated": bool(identity.banned),
        "two_factor_enabled": bool(identity.two_factor_enabled),
    }
    better_auth_store.set_banned(db, identity.id, banned=False, reason=None)
    better_auth_store.clear_two_factor(db, identity.id)
    if not has_password:
        better_auth_store.set_password(db, identity.id, password=password)
    token = admin_enrolment.issue_token(db, identity.id)
    audit_log.record_system_action(
        db,
        action=audit_log.ADMIN_RECOVER,
        target_type="user",
        target_id=user.id,
        before=before,
        after={
            "is_deactivated": False,
            "two_factor_enabled": False,
            "password_set": not has_password,
            "via": VIA,
        },
    )
    db.commit()
    return token


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--create", action="store_true", help="create a new email + password admin"
    )
    mode.add_argument("--recover", metavar="EMAIL", help="recover an existing admin")
    parser.add_argument("--email", help="email of the admin to create (--create)")
    parser.add_argument("--name", default="", help="display name (--create)")
    args = parser.parse_args()

    if args.create and not args.email:
        parser.error("--create needs --email")

    db = SessionLocal()
    try:
        if args.create:
            password = _ask_password()
            token = create_admin(
                db, email=args.email, name=args.name, password=password
            )
            print(f"{normalize_email(args.email)} is a new admin account.")
        else:
            email = normalize_email(args.recover)
            identity = (
                db.query(AuthIdentity).filter(AuthIdentity.email == email).first()
            )
            if identity is None:
                sys.exit("No account has that email.")
            password = None
            if (
                identity.role == "admin"
                and not better_auth_store.has_credential_account(db, identity.id)
            ):
                print(
                    "This admin never accepted the invite, so it has no password yet."
                )
                password = _ask_password()
            token = recover_admin(db, identity, password=password)
            print(f"{email} was recovered. Its 2FA is off and all sessions ended.")
        print("Sign in on the admin site, then open this link (one time, 24 hours):")
        print(admin_enrolment.setup_url(token))
    finally:
        db.close()


if __name__ == "__main__":
    main()
