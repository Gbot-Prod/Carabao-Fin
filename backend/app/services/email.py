from __future__ import annotations

import os

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
