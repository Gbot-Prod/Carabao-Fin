from __future__ import annotations

import os
from html import escape

import resend

resend.api_key = os.getenv("RESEND_KEY", "")

FROM_ADDRESS = os.getenv("RESEND_FROM", "Carabao <onboarding@resend.dev>")


def send_signup_otp_email(to: str, otp: str) -> None:
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Your Carabao verification code",
            "html": f"""
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f7fcf8;border-radius:12px">
                  <h2 style="color:#173d25;margin:0 0 8px">Verify your email</h2>
                  <p style="color:#4a5e4d;margin:0 0 24px">Use this code to continue creating your Carabao account:</p>
                  <p style="font-size:28px;letter-spacing:0.2em;font-weight:700;color:#173d25;margin:0 0 24px">{otp}</p>
                  <p style="color:#8a9a8c;font-size:12px;margin:0">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
                </div>
            """,
        }
    )


def send_verification_email(to: str, verification_url: str) -> None:
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Verify your Carabao account",
            "html": f"""
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f7fcf8;border-radius:12px">
                  <h2 style="color:#173d25;margin:0 0 8px">Verify your email</h2>
                  <p style="color:#4a5e4d;margin:0 0 24px">Click the button below to verify your email and complete your Carabao signup.</p>
                  <a href="{verification_url}" style="display:inline-block;padding:12px 28px;background:#31925d;color:white;border-radius:8px;text-decoration:none;font-weight:600">Verify email</a>
                  <p style="color:#8a9a8c;font-size:12px;margin:24px 0 0">If you didn't sign up for Carabao, you can safely ignore this email.</p>
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
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f7fcf8;border-radius:12px">
                  <h2 style="color:#173d25;margin:0 0 8px">Your refund has been sent</h2>
                  <p style="color:#4a5e4d;margin:0 0 16px">We refunded <strong>PHP {amount:,}</strong> for order {escape(order_ref)}.</p>
                  <p style="color:#4a5e4d;margin:0 0 4px">Method: {escape(method)}</p>
                  <p style="color:#4a5e4d;margin:0 0 24px">Reference: {escape(reference)}</p>
                  <p style="color:#8a9a8c;font-size:12px;margin:0">Depending on your bank or e-wallet, it can take a few days to appear.</p>
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
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f7fcf8;border-radius:12px">
                  <h2 style="color:#173d25;margin:0 0 8px">Reset your password</h2>
                  <p style="color:#4a5e4d;margin:0 0 24px">Someone asked to reset the password for this Carabao account. Use the button below to choose a new one.</p>
                  <a href="{escape(reset_url)}" style="display:inline-block;padding:12px 28px;background:#31925d;color:white;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a>
                  <p style="color:#8a9a8c;font-size:12px;margin:24px 0 0">This link expires in 1 hour. If you didn't ask for a reset, you can ignore this email; your password stays the same.</p>
                </div>
            """,
        }
    )


def send_password_reset_otp_email(to: str, otp: str) -> None:
    """Mobile reset code (E6)."""
    resend.Emails.send(
        {
            "from": FROM_ADDRESS,
            "to": [to],
            "subject": "Your Carabao password reset code",
            "html": f"""
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f7fcf8;border-radius:12px">
                  <h2 style="color:#173d25;margin:0 0 8px">Reset your password</h2>
                  <p style="color:#4a5e4d;margin:0 0 24px">Enter this code in the Carabao app to choose a new password:</p>
                  <p style="font-size:28px;letter-spacing:0.2em;font-weight:700;color:#173d25;margin:0 0 24px">{escape(otp)}</p>
                  <p style="color:#8a9a8c;font-size:12px;margin:0">This code expires in 10 minutes. If you didn't ask for a reset, you can ignore this email.</p>
                </div>
            """,
        }
    )
