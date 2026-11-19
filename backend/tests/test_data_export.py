"""CF-0069 (B18): a person downloads their own data, and only theirs."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import users
from app.models.chat import ChatMessage, Conversation
from app.models.farm_follow import FarmFollow
from app.models.order import Order
from app.models.produce import Produce
from app.models.review import Review
from app.models.saved_produce import SavedProduce
from app.models.user import User
from app.models.user_address import UserAddress
from app.services import data_export, rate_limit
from tests.shared_fixtures import _buyer


def _client(db: Session, user: Any) -> TestClient:
    app = FastAPI()
    app.include_router(users.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _life(db: Session, user: User, merchant: Any, tag: str) -> Order:
    """An address, a paid order with a review, a follow, a save and a chat."""
    db.add(
        UserAddress(
            user_id=user.id,
            label=f"Home {tag}",
            region="Region III",
            province="Bulacan",
            city="Malolos",
            barangay="Poblacion",
            address=f"{tag} Mabini St",
            postal_code="3000",
            is_default=True,
        )
    )
    produce = Produce(
        merchant_id=merchant.id, name=f"Talong {tag}", price=50, stock_quantity=5
    )
    db.add(produce)
    db.flush()
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status="delivered",
        total_price=140,
        delivery_fee=40,
        items=[
            {
                "produce_id": produce.id,
                "produce": f"Talong {tag}",
                "quantity": 2,
                "price": 50,
            }
        ],
        notes=f"note {tag}",
    )
    db.add(order)
    db.flush()
    db.add(
        Review(
            order_id=order.id,
            user_id=user.id,
            merchant_id=merchant.id,
            rating=5,
            comment=f"great {tag}",
        )
    )
    db.add(FarmFollow(user_id=user.id, merchant_id=merchant.id))
    db.add(SavedProduce(user_id=user.id, produce_id=produce.id))
    convo = Conversation(kind="order", order_id=order.id)
    db.add(convo)
    db.flush()
    db.add(
        ChatMessage(
            conversation_id=convo.id,
            sender_id=user.id,
            sender_role="buyer",
            body=f"hello from {tag}",
        )
    )
    db.add(
        ChatMessage(
            conversation_id=convo.id,
            sender_id=merchant.user_id,
            sender_role="merchant",
            body=f"farm reply to {tag}",
        )
    )
    db.commit()
    return order


def test_export_has_my_data_and_nobody_elses(db: Session, merchant: Any) -> None:
    me, _ = _buyer(db, "me@example.com", "Ana Santos")
    other, _ = _buyer(db, "other@example.com", "Ben Cruz")
    mine = _life(db, me, merchant, "ME")
    _life(db, other, merchant, "OTHER")

    res = _client(db, me).get("/users/me/export")

    assert res.status_code == 200, res.text
    assert res.headers["content-disposition"].startswith(
        'attachment; filename="carabao-my-data-'
    )
    data = res.json()
    text = json.dumps(data)
    assert data["format_version"] == data_export.FORMAT_VERSION
    assert data["account"]["email"] == "me@example.com"
    assert [a["address"] for a in data["addresses"]] == ["ME Mabini St"]
    [order] = data["orders"]
    assert order["id"] == mine.id and order["farm"] == merchant.merchant_name
    assert order["total_price"] == 140 and order["notes"] == "note ME"
    assert [r["comment"] for r in data["reviews"]] == ["great ME"]
    assert [f["farm"] for f in data["following"]] == [merchant.merchant_name]
    assert [s["produce"] for s in data["saved_produce"]] == ["Talong ME"]
    assert [m["body"] for m in data["messages_sent"]] == ["hello from ME"]
    assert data["farm"] is None
    # Nothing of the other buyer, and not the farm's side of the chat.
    for leaked in ("OTHER", "other@example.com", "Ben Cruz", "farm reply"):
        assert leaked not in text, leaked


def test_a_farm_owner_gets_the_farm_without_secrets(db: Session, merchant: Any) -> None:
    merchant.tin = "123-456-789-000"
    merchant.rsbsa_number = "03-14-10-001-00001"
    db.commit()
    owner = db.get(User, merchant.user_id)

    data = _client(db, owner).get("/users/me/export").json()

    assert data["farm"]["merchant_name"] == merchant.merchant_name
    assert data["farm"]["address"] == "Purok 1"
    text = json.dumps(data)
    for secret in ("123-456-789-000", "03-14-10-001-00001"):
        assert secret not in text, secret
    for key in ('"tin"', '"tin_hmac"', '"rsbsa_number"', '"account_number"'):
        assert key not in text, key


def test_export_is_rate_limited(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "data_export", rate_limit.Limit(1, 60)
    )
    me, _ = _buyer(db, "me@example.com")
    client = _client(db, me)
    assert client.get("/users/me/export").status_code == 200
    res = client.get("/users/me/export")
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1
