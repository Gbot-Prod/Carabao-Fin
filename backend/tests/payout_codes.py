"""CF-0004: saving a payout method takes the SMS code sent for it.

``fake_sms`` (autouse in conftest) captures what payout_otp would text;
``save_payout_info`` does the two steps a merchant does.
"""

SENT: list[dict] = []
EMAILS: list[dict] = []


def fake_send_otp(*, number, message, code, **_):
    SENT.append({"number": number, "message": message, "code": code})
    return code


def fake_send_sms(*, number, message, **_):
    SENT.append({"number": number, "message": message, "code": None})


def fake_send_payout_change_email(to, *, old, new):
    EMAILS.append({"to": to, "old": old, "new": new})


def last_code() -> str:
    return next(m["code"] for m in reversed(SENT) if m["code"])


def save_payout_info(client, payload: dict):
    """POST the code request, then PUT with the code. Returns the failing or
    final response."""
    resp = client.post("/merchants/me/payout-info/code", json=payload)
    if resp.status_code != 200:
        return resp
    return client.put(
        "/merchants/me/payout-info", json={**payload, "code": last_code()}
    )
