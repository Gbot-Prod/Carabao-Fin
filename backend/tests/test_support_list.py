"""CF-0076 (B61): the admin support list is built in SQL (a fixed number of
queries), unanswered first, then most recent, a window at a time."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.api.routes import support_chat
from app.services import rate_limit
from tests.shared_fixtures import _buyer
from tests.test_support_chat import _admin as _untyped_admin
from tests.test_support_chat import _client

_admin: Any = _untyped_admin  # an older, untyped helper


@pytest.fixture(autouse=True)
def _no_send_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "support_chat_send", rate_limit.Limit(10_000, 60)
    )


@contextmanager
def _statements(db: Session) -> Iterator[list[str]]:
    seen: list[str] = []
    engine: Any = db.get_bind()

    def before(_c: Any, _cur: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", before)


def _conversation(
    db: Session, n: int, messages: int, answered: bool, admin: Any
) -> int:
    user, _ = _buyer(db, f"user{n}@example.com")
    me = _client(db, user)
    for i in range(messages):
        assert (
            me.post("/support/messages", json={"body": f"user {n} msg {i}"}).status_code
            == 200
        )
    conv_id = next(
        c["conversation_id"]
        for c in _client(db, admin).get("/admin/support", params={"limit": 200}).json()
        if c["user_email"] == f"user{n}@example.com"
    )
    if answered:
        _client(db, admin).post(
            f"/admin/support/{conv_id}/messages", json={"body": "on it"}
        )
    return int(conv_id)


def test_unanswered_first_then_newest(db: Session) -> None:
    admin = _admin(db)
    old_open = _conversation(db, 1, messages=2, answered=False, admin=admin)
    answered = _conversation(db, 2, messages=1, answered=True, admin=admin)
    new_open = _conversation(db, 3, messages=1, answered=False, admin=admin)

    rows = _client(db, admin).get("/admin/support").json()

    assert [r["conversation_id"] for r in rows] == [new_open, old_open, answered]
    assert [r["unread"] for r in rows] == [1, 2, 0]
    assert rows[2]["last_message"] == "on it"
    assert rows[0]["user_email"] == "user3@example.com"


def test_window_and_bounds(db: Session) -> None:
    admin = _admin(db)
    ids = [
        _conversation(db, n, messages=1, answered=False, admin=admin) for n in range(4)
    ]
    client = _client(db, admin)

    first = client.get("/admin/support", params={"limit": 2}).json()
    rest = client.get("/admin/support", params={"limit": 2, "offset": 2}).json()
    assert [r["conversation_id"] for r in first + rest] == ids[::-1]
    for params in (
        {"limit": 0},
        {"limit": support_chat.SUPPORT_LIST_MAX + 1},
        {"offset": -1},
    ):
        assert client.get("/admin/support", params=params).status_code == 422


def test_same_number_of_queries_for_more_conversations(db: Session) -> None:
    admin = _admin(db)
    for n in range(2):
        _conversation(db, n, messages=2, answered=n == 0, admin=admin)
    client = _client(db, admin)
    client.get("/admin/support")
    with _statements(db) as two:
        assert len(client.get("/admin/support").json()) == 2
    for n in range(2, 6):
        _conversation(db, n, messages=2, answered=n % 2 == 0, admin=admin)
    client.get("/admin/support")  # warm: the admin row is loaded once per session
    with _statements(db) as six:
        assert len(client.get("/admin/support").json()) == 6
    # Was 4 queries per conversation plus one per user.
    assert len(six) == len(two)
