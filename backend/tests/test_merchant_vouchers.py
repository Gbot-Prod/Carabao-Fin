"""CF-0061: a farm manages its own voucher codes (B05 slice 2)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_vouchers
from app.models.order import Order
from app.models.statuses import OrderStatus
from app.models.voucher import Voucher, VoucherRedemption
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant

URL = "/merchants/me/vouchers"


def _client(db: Session, user: Any) -> TestClient:
    app = FastAPI()
    app.include_router(merchant_vouchers.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _create(client: TestClient, **fields: Any) -> Any:
    body: dict[str, Any] = {"code": "save10", "kind": "percent", "value": 10}
    body.update(fields)
    return client.post(URL, json=body)


def test_create_list_edit_and_delete(db: Session, merchant: Any) -> None:
    client = _client(db, merchant.user)

    res = _create(client, code=" save10 ", max_discount=50, usage_limit=100)
    assert res.status_code == 201, res.text
    made = res.json()
    assert made["code"] == "SAVE10"  # stored upper case, trimmed
    assert (made["kind"], made["value"], made["max_discount"]) == ("percent", 10, 50)
    assert made["uses"] == 0 and made["active"] is True and made["per_user_limit"] == 1

    listed = client.get(URL).json()
    assert [v["code"] for v in listed] == ["SAVE10"]

    edit = client.patch(
        f"{URL}/{made['id']}", json={"active": False, "usage_limit": None}
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["active"] is False
    assert edit.json()["usage_limit"] is None  # null clears the cap
    assert edit.json()["max_discount"] == 50  # not sent, kept

    assert client.delete(f"{URL}/{made['id']}").status_code == 204
    assert db.query(Voucher).count() == 0


def test_other_farms_vouchers_are_not_reachable(db: Session, merchant: Any) -> None:
    rival: Any = _other_merchant(db)
    theirs: Any = Voucher(merchant_id=rival.id, code="RIVAL", kind="fixed", value=20)
    db.add(theirs)
    db.commit()
    client = _client(db, merchant.user)

    assert client.get(URL).json() == []
    assert client.patch(f"{URL}/{theirs.id}", json={"active": False}).status_code == 404
    assert client.delete(f"{URL}/{theirs.id}").status_code == 404
    db.refresh(theirs)
    assert theirs.active is True

    # The same code is fine on another farm.
    assert _create(client, code="RIVAL").status_code == 201


def test_buyer_without_a_farm_gets_404(db: Session) -> None:
    buyer, _ = _buyer(db, "plain@example.com")
    client = _client(db, buyer)
    assert client.get(URL).status_code == 404
    assert _create(client).status_code == 404


@pytest.mark.parametrize(
    "fields",
    [
        {"code": "ab"},  # too short
        {"code": "bad code"},
        {"code": "A" * 33},
        {"kind": "bogus"},
        {"value": 0},
        {"value": 95},  # percent above 90
        {"kind": "fixed", "value": 20, "max_discount": 10},
        {"min_subtotal": -1},
        {"usage_limit": 0},
        {"per_user_limit": 0},
        {"starts_at": "2026-12-10T00:00:00Z", "expires_at": "2026-12-01T00:00:00Z"},
        {"merchant_id": 999},  # unknown field
        {"uses": 5},
    ],
)
def test_bad_input_is_refused(
    db: Session, merchant: Any, fields: dict[str, Any]
) -> None:
    res = _create(_client(db, merchant.user), **fields)
    assert res.status_code == 422, (fields, res.text)
    assert db.query(Voucher).count() == 0


def test_edit_is_checked_with_the_stored_values(db: Session, merchant: Any) -> None:
    client = _client(db, merchant.user)
    made = _create(client, kind="fixed", value=100).json()

    # Switching to percent keeps value 100: out of range together.
    res = client.patch(f"{URL}/{made['id']}", json={"kind": "percent"})
    assert res.status_code == 422
    for body in ({"code": "NEW"}, {"value": None}, {"active": None}):
        res = client.patch(f"{URL}/{made['id']}", json=body)
        assert res.status_code == 422, body
    ok = client.patch(f"{URL}/{made['id']}", json={"kind": "percent", "value": 15})
    assert ok.status_code == 200
    assert (ok.json()["kind"], ok.json()["value"], ok.json()["code"]) == (
        "percent",
        15,
        "SAVE10",
    )


def test_duplicate_code_and_cap(
    db: Session, merchant: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _client(db, merchant.user)
    assert _create(client).status_code == 201
    dup = _create(client, code="Save10")
    assert dup.status_code == 409
    assert "already" in dup.json()["detail"]

    monkeypatch.setattr(merchant_vouchers, "MAX_VOUCHERS_PER_MERCHANT", 2)
    assert _create(client, code="TWO22").status_code == 201
    capped = _create(client, code="THREE")
    assert capped.status_code == 409
    assert db.query(Voucher).count() == 2


def test_used_voucher_cannot_be_deleted_and_shows_uses(
    db: Session, merchant: Any
) -> None:
    buyer, _ = _buyer(db, "b2@example.com")
    client = _client(db, merchant.user)
    made = _create(client).json()
    live = Order(
        user_id=buyer.id, merchant_id=merchant.id, status=OrderStatus.PROCESSING,
        total_price=90, items=[], discount=10, voucher_code="SAVE10",
    )
    gone = Order(
        user_id=buyer.id, merchant_id=merchant.id, status=OrderStatus.CANCELLED,
        total_price=90, items=[], discount=10, voucher_code="SAVE10",
    )
    db.add_all([live, gone])
    db.flush()
    for order in (live, gone):
        db.add(
            VoucherRedemption(
                voucher_id=made["id"], user_id=buyer.id, order_id=order.id, discount=10
            )
        )
    db.commit()

    assert client.get(URL).json()[0]["uses"] == 1  # the cancelled one is not counted
    res = client.delete(f"{URL}/{made['id']}")
    assert res.status_code == 409
    assert "Turn it off" in res.json()["detail"]
    assert db.query(Voucher).count() == 1
