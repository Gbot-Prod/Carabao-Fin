"""The merchant's orders tab sees what the buyer asked for at checkout."""

from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.order import Order
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User


def _merchant_client(db, merchant) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _scheduled_order(db, merchant, buyer, **schedule):
    """A paid order: the only kind the merchant's orders tab shows."""
    user, _ = buyer
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=OrderStatus.PROCESSING,
        total_price=500,
        items=[],
        **schedule,
    )
    db.add(order)
    db.flush()
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=500,
            platform_fee=10,
            merchant_amount=490,
            status=TransactionStatus.PAID,
        )
    )
    db.commit()
    return order


def test_order_list_includes_schedule_and_notes(db, merchant, buyer):  # noqa: F811
    scheduled = _scheduled_order(
        db,
        merchant,
        buyer,
        requested_delivery_date=date(2026, 11, 20),
        delivery_window="08:00 – 10:00",
        notes="Leave at the gate",
    )
    legacy = _scheduled_order(db, merchant, buyer)

    rows = {
        o["id"]: o
        for o in _merchant_client(db, merchant).get("/merchants/me/orders").json()
    }

    assert rows[scheduled.id]["requested_delivery_date"] == "2026-11-20"
    assert rows[scheduled.id]["delivery_window"] == "08:00 – 10:00"
    assert rows[scheduled.id]["notes"] == "Leave at the gate"
    assert rows[legacy.id]["requested_delivery_date"] is None
    assert rows[legacy.id]["notes"] is None


def test_status_update_keeps_schedule_and_notes(db, merchant, buyer):  # noqa: F811
    order = _scheduled_order(
        db,
        merchant,
        buyer,
        requested_delivery_date=date(2026, 11, 20),
        delivery_window="14:00 – 16:00",
        notes="Call on arrival",
    )

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status",
        json={"status": "cancelled", "cancel_reason": "out_of_stock"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["payment_status"] == "refund_pending"
    assert body["requested_delivery_date"] == "2026-11-20"
    assert body["delivery_window"] == "14:00 – 16:00"
    assert body["notes"] == "Call on arrival"
    assert body["cancel_reason"] == "Out of stock"


# --- mobile "Incoming orders" (M3) ---------------------------------------------

MOBILE_SCREEN = (
    __import__("pathlib").Path(__file__).resolve().parents[2]
    / "mobile/CarabaoMobile/src/screens/MerchantOrdersScreen.tsx"
)


def test_mobile_offers_only_moves_the_server_allows():
    import re

    from app.services.order_status import MERCHANT_TRANSITIONS

    source = MOBILE_SCREEN.read_text(encoding="utf-8")
    steps = source.split("const NEXT_STEPS", 1)[1].split("};", 1)[0]
    offered = {
        (frm, to)
        for frm, block in re.findall(r"(\w+): \[([^\]]*)\]", steps)
        for to in re.findall(r"to: '(\w+)'", block)
    }
    cancellable = re.search(r"const CANCELLABLE[^=]*= \[([^\]]*)\]", source).group(1)
    offered |= {(frm, "cancelled") for frm in re.findall(r"'(\w+)'", cancellable)}

    assert offered, "could not read the mobile transitions"
    for frm, to in offered:
        assert OrderStatus(to) in MERCHANT_TRANSITIONS[OrderStatus(frm)], (frm, to)


def test_mobile_status_update_moves_order_on(db, merchant, buyer):  # noqa: F811
    order = _scheduled_order(db, merchant, buyer)
    order.status = OrderStatus.SHIPPED
    db.commit()

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status", json={"status": "out_for_delivery"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "out_for_delivery"


def test_merchant_cannot_update_another_merchants_order(db, merchant, buyer):  # noqa: F811
    from tests.test_merchant_listings import _other_merchant

    order = _scheduled_order(db, merchant, buyer)
    rival = _other_merchant(db)

    resp = _merchant_client(db, rival).patch(
        f"/merchants/me/orders/{order.id}/status",
        json={"status": "cancelled", "cancel_reason": "out_of_stock"},
    )

    assert resp.status_code == 404
    db.expire_all()
    assert db.get(Order, order.id).status == OrderStatus.PROCESSING
    assert _merchant_client(db, rival).get("/merchants/me/orders").json() == []


# --- cancel reason --------------------------------------------------------------


def test_cancel_needs_a_reason(db, merchant, buyer):  # noqa: F811
    order = _scheduled_order(db, merchant, buyer)
    client = _merchant_client(db, merchant)
    url = f"/merchants/me/orders/{order.id}/status"

    missing = client.patch(url, json={"status": "cancelled"})
    unknown = client.patch(url, json={"status": "cancelled", "cancel_reason": "meh"})
    other_blank = client.patch(
        url, json={"status": "cancelled", "cancel_reason": "other", "cancel_note": "  "}
    )
    too_long = client.patch(
        url,
        json={
            "status": "cancelled",
            "cancel_reason": "other",
            "cancel_note": "x" * 301,
        },
    )
    on_ship = client.patch(
        url, json={"status": "shipped", "cancel_reason": "out_of_stock"}
    )

    assert missing.status_code == 422
    assert missing.json()["detail"] == "Choose why you are cancelling this order"
    assert unknown.status_code == 422
    assert other_blank.status_code == 422
    assert other_blank.json()["detail"] == "Tell the buyer why you are cancelling"
    assert too_long.status_code == 422
    assert on_ship.status_code == 422
    db.expire_all()
    assert db.get(Order, order.id).status == OrderStatus.PROCESSING


def test_cancel_with_other_reason_texts_the_buyer(db, merchant, buyer, monkeypatch):  # noqa: F811
    from app.models.notification import Notification
    from app.services import sms_service

    user, _ = buyer
    assert user.phone_number  # the test buyer has a verified number
    sent = []
    monkeypatch.setattr(sms_service, "send_sms", lambda **kw: sent.append(kw))
    order = _scheduled_order(db, merchant, buyer)

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status",
        json={
            "status": "cancelled",
            "cancel_reason": "other",
            "cancel_note": "Our truck broke down",
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["cancel_reason"] == "Our truck broke down"
    notice = (
        db.query(Notification).filter_by(user_id=user.id, kind="order_cancelled").one()
    )
    assert "Reason: Our truck broke down." in notice.body
    [sms] = sent
    assert sms["number"] == user.phone_number
    assert "Reason: Our truck broke down." in sms["message"]


def test_cancel_skips_sms_when_buyer_opted_out(db, merchant, buyer, monkeypatch):  # noqa: F811
    from app.services import sms_service

    user, _ = buyer
    user.notifications_preferences = {"order_updates": False}
    db.commit()
    sent = []
    monkeypatch.setattr(sms_service, "send_sms", lambda **kw: sent.append(kw))
    order = _scheduled_order(db, merchant, buyer)

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status",
        json={"status": "cancelled", "cancel_reason": "quality"},
    )

    assert resp.status_code == 200, resp.text
    assert sent == []
