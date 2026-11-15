import pytest

from app.integrations.sms import semaphore

CFG = semaphore.SemaphoreConfig(api_key="k", sendername="CARABAO")


class _Resp:
    def __init__(self, payload, ok=True):
        self._payload = payload
        self.ok = ok

    def json(self):
        return self._payload


@pytest.fixture
def posted(monkeypatch):
    calls = []
    response = {"payload": [{"message_id": 1, "status": "Pending", "code": 123456}]}

    def fake_post(url, data, timeout):
        calls.append((url, data))
        return _Resp(response["payload"])

    monkeypatch.setattr(semaphore.requests, "post", fake_post)
    return calls, response


def test_send_otp_hits_otp_route_with_placeholder_and_code(posted):
    calls, _ = posted
    code = semaphore.send_otp(
        number="639123456789", message="Code: {otp}", code="123456", config=CFG
    )
    url, data = calls[0]
    assert url == "https://api.semaphore.co/api/v4/otp"
    assert data["message"] == "Code: {otp}"
    assert data["code"] == "123456"
    assert data["sendername"] == "CARABAO"
    assert code == "123456"


def test_send_otp_restores_leading_zeros(posted):
    _, response = posted
    response["payload"] = [{"code": 12345}]  # JSON number for "012345"
    assert (
        semaphore.send_otp(number="639123456789", message="{otp}", code="012345", config=CFG)
        == "012345"
    )


def test_send_otp_returns_semaphore_code_when_it_differs(posted):
    _, response = posted
    response["payload"] = [{"code": "999999"}]
    assert (
        semaphore.send_otp(number="639123456789", message="{otp}", code="111111", config=CFG)
        == "999999"
    )


def test_send_otp_falls_back_to_our_code_when_absent(posted):
    _, response = posted
    response["payload"] = [{"status": "Pending"}]
    assert (
        semaphore.send_otp(number="639123456789", message="{otp}", code="111111", config=CFG)
        == "111111"
    )


def test_send_otp_requires_placeholder(posted):
    with pytest.raises(semaphore.SemaphoreError):
        semaphore.send_otp(number="639123456789", message="Code 123456", code="123456", config=CFG)


def test_send_sms_still_uses_messages_route(posted):
    calls, _ = posted
    semaphore.send_sms(number="639123456789", message="Hello", config=CFG)
    assert calls[0][0] == "https://api.semaphore.co/api/v4/messages"
    assert "code" not in calls[0][1]
