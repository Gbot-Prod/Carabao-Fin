from __future__ import annotations

import os
from html import escape

import resend

resend.api_key = os.getenv("RESEND_KEY", "")

FROM_ADDRESS = os.getenv("RESEND_FROM", "Carabao <onboarding@resend.dev>")


# CF-0082: the inline styles every email uses (email clients need inline
# styles). One copy each; the HTML below names them.
BOX = (
    "font-family:sans-serif;max-width:520px;margin:0 auto;"
    "padding:32px 24px;background:#f7fcf8;border-radius:12px"
)
TITLE = "color:#173d25;margin:0 0 8px"
TEXT_24 = "color:#4a5e4d;margin:0 0 24px"
BUTTON = (
    "display:inline-block;padding:12px 28px;background:#31925d;"
    "color:white;border-radius:8px;text-decoration:none;"
    "font-weight:600"
)
NOTE_SPACED = "color:#8a9a8c;font-size:12px;margin:24px 0 0"
TEXT_16 = "color:#4a5e4d;margin:0 0 16px"
TEXT_4 = "color:#4a5e4d;margin:0 0 4px"
NOTE = "color:#8a9a8c;font-size:12px;margin:0"
CODE = (
    "font-size:28px;letter-spacing:6px;font-weight:700;"
    "color:#173d25;margin:0 0 24px"
)


def send_verification_email(to: str, verification_url: str) -> None:
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Verify your email for Carabao",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Verify your email</h2>
                  <p style="{TEXT_24}">Click the button below to confirm this email
                    for your Carabao account. You'll get receipts and can reset your
                    password here.</p>
                  <a href="{escape(verification_url)}" style="{BUTTON}">Verify email</a>
                  <p style="{NOTE_SPACED}">If you didn't sign up for Carabao, you can
                    safely ignore this email.</p>
                </div>
            """,
        }
    )


def send_refund_email(
    to: str, *, order_ref: str, amount: int, method: str, reference: str
) -> None:
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": f"Your Carabao refund for order {order_ref}",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Your refund has been sent</h2>
                  <p style="{TEXT_16}">We refunded <strong>PHP {amount:,}</strong> for
                    order {escape(order_ref)}.</p>
                  <p style="{TEXT_4}">Method: {escape(method)}</p>
                  <p style="{TEXT_24}">Reference: {escape(reference)}</p>
                  <p style="{NOTE}">Depending on your bank or e-wallet, it can take a
                    few days to appear.</p>
                </div>
            """,
        }
    )


def send_password_reset_email(to: str, reset_url: str) -> None:
    """Web reset link from BetterAuth (E6)."""
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Reset your Carabao password",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Reset your password</h2>
                  <p style="{TEXT_24}">Someone asked to reset the password for this
                    Carabao account. Use the button below to choose a new one.</p>
                  <a href="{escape(reset_url)}" style="{BUTTON}">Choose a new
                    password</a>
                  <p style="{NOTE_SPACED}">This link expires in 1 hour. If you didn't
                    ask for a reset, you can ignore this email; your password stays the
                    same.</p>
                </div>
            """,
        }
    )


def send_admin_enrolment_email(to: str, setup_url: str) -> None:
    """The one-time link a new admin uses to set up two-step verification
    (CF-0018)."""
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Set up two-step verification for your Carabao admin account",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Set up two-step verification</h2>
                  <p style="{TEXT_24}">Your Carabao account is now an admin account.
                    Admins must use an authenticator app. Sign in, then use the button
                    below to set it up.</p>
                  <a href="{escape(setup_url)}" style="{BUTTON}">Set up two-step
                    verification</a>
                  <p style="{NOTE_SPACED}">This link works one time and expires in 24
                    hours. Do not share it. If you did not expect this email, contact
                    Carabao support.</p>
                </div>
            """,
        }
    )


def send_payout_change_email(to: str, *, old: str, new: str) -> None:
    """Security alert: the merchant's payout account changed (CF-0019)."""
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Your Carabao payout account was changed",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Your payout account was changed</h2>
                  <p style="{TEXT_16}">Payouts for your shop now go to
                    <strong>{escape(new)}</strong>. Before, they went to
                    {escape(old)}.</p>
                  <p style="{TEXT_24}">If you did not make this change, contact
                    Carabao support now and do not request a payout.</p>
                  <p style="{NOTE}">We send this email for every payout account
                    change. You cannot turn it off.</p>
                </div>
            """,
        }
    )


def send_contact_email_code(to: str, code: str) -> None:
    """The code that proves a merchant applicant's contact email."""
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": f"Your Carabao verification code is {code}",
            "html": f"""
                <div style="{BOX}">
                  <h2 style="{TITLE}">Confirm your contact email</h2>
                  <p style="{TEXT_16}">Enter this code in your Carabao merchant
                    application:</p>
                  <p style="{CODE}">{escape(code)}</p>
                  <p style="{NOTE}">The code expires in 10 minutes. Do not share it.
                    If you did not apply as a merchant, you can ignore this email.</p>
                </div>
            """,
        }
    )
