"""Deleting an account takes the SMS code sent for it.

The autouse ``_payout_sms`` fixture (conftest) also captures the deletion
codes; ``delete_account`` does the two steps a user does.
"""

from tests.payout_codes import last_code


def delete_account(client, password: str | None = None, **kwargs):
    """POST the code request (with the password, when the account has one),
    then DELETE with the code. Returns the failing or final response."""
    resp = client.post(
        "/users/me/delete-code", json={"password": password}, **kwargs
    )
    if resp.status_code != 200:
        return resp
    return client.request("DELETE", "/users/me", json={"code": last_code()}, **kwargs)
