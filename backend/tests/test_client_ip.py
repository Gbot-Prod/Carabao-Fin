"""CF-0083 (B36): per-IP limits count the address our proxy saw, not one the
client wrote into X-Forwarded-For."""

from __future__ import annotations

from typing import Any

import pytest
from starlette.requests import Request

from app.services import rate_limit


def _request(forwarded: str | None, peer: str = "10.0.0.9") -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    scope: dict[str, Any] = {
        "type": "http",
        "headers": headers,
        "client": (peer, 1234),
        "method": "GET",
        "path": "/",
    }
    return Request(scope)


@pytest.fixture
def behind_proxy(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    monkeypatch.delenv("RATE_LIMIT_PROXY_HOPS", raising=False)
    return monkeypatch


def test_a_spoofed_left_entry_does_not_change_the_key(behind_proxy: Any) -> None:
    # The proxy appended the real client address after what the client sent.
    assert rate_limit.client_ip(_request("1.2.3.4, 203.0.113.5")) == "203.0.113.5"
    assert rate_limit.client_ip(_request("9.9.9.9, 203.0.113.5")) == "203.0.113.5"


def test_a_proxy_that_replaces_the_header(behind_proxy: Any) -> None:
    assert rate_limit.client_ip(_request("203.0.113.5")) == "203.0.113.5"
    assert rate_limit.client_ip(_request(" 203.0.113.5 , ")) == "203.0.113.5"


def test_two_proxies(behind_proxy: Any) -> None:
    behind_proxy.setenv("RATE_LIMIT_PROXY_HOPS", "2")
    # client spoof, real client (added by the edge), edge (added by our proxy)
    assert (
        rate_limit.client_ip(_request("1.2.3.4, 203.0.113.5, 10.1.1.1"))
        == "203.0.113.5"
    )
    assert rate_limit.client_ip(_request("203.0.113.5")) == "203.0.113.5"
    behind_proxy.setenv("RATE_LIMIT_PROXY_HOPS", "junk")
    assert rate_limit.proxy_hops() == 1


def test_without_the_proxy_setting_the_header_is_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("RATE_LIMIT_TRUST_PROXY", raising=False)
    assert rate_limit.client_ip(_request("1.2.3.4")) == "10.0.0.9"
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    assert rate_limit.client_ip(_request(None)) == "10.0.0.9"
    assert rate_limit.client_ip(_request("")) == "10.0.0.9"
