"""Buyer disputes and admin decisions (ORDER_PROOF_PHOTOS_PLAN.md, Phase 2)."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.admin_audit_log import AdminAuditLog
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.services import payout_service
from tests.test_admin_orders import _admin
from tests.test_admin_orders import _client as _admin_client
from tests.test_merchant_orders import _scheduled_order


def _buyer_client(db, buyer) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: buyer[0]
    return TestClient(app)


def _merchant_delivered(db, merchant, buyer, hours_ago=1, flags=None):
    order = _scheduled_order(db, merchant, buyer)
    now = datetime.now(UTC)
    order.status = OrderStatus.DELIVERED
    order.delivery_confirmed_by = "merchant"
    order.shipped_at = now - timedelta(hours=hours_ago + 1)
    order.delivered_at = now - timedelta(hours=hours_ago)
    db.add(
        OrderProofPhoto(
            order_id=order.id,
            kind="dropoff",
            object_key=f"proof/{order.id}/dropoff/k",
            sha256=f"{order.id:064d}",
            content_type="image/jpeg",
            flags=flags or [],
        )
    )
    db.commit()
    return order


def test_dispute_in_the_hold_freezes_the_payout(db, merchant, buyer):
    order = _merchant_delivered(db, merchant, buyer)
    client = _buyer_client(db, buyer)

    detail = client.get(f"/orders/me/{order.id}").json()
    resp = client.post(f"/orders/me/{order.id}/dispute-delivery")

    assert detail["can_dispute"] is True
    assert detail["proof_photos"] == ["dropoff"]
    assert resp.status_code == 200, resp.text
    assert resp.json()["can_dispute"] is False
    assert client.post(f"/orders/me/{order.id}/dispute-delivery").status_code == 409
    # The hold ended, but the open dispute keeps it unpaid.
    order.delivered_at = datetime.now(UTC) - timedelta(hours=72)
    db.commit()
    assert payout_service.claimable_transactions(db, merchant.id) == []


def test_dispute_after_the_window_is_refused(db, merchant, buyer):
    order = _merchant_delivered(db, merchant, buyer, hours_ago=49)

    resp = _buyer_client(db, buyer).post(f"/orders/me/{order.id}/dispute-delivery")

    assert resp.status_code == 409
    assert "support" in resp.json()["detail"]


def test_buyer_cannot_see_the_failed_dropoff_photo(db, merchant, buyer):
    order = _merchant_delivered(db, merchant, buyer)

    resp = _buyer_client(db, buyer).get(f"/orders/me/{order.id}/proof/attempt")

    assert resp.status_code == 404


def test_admin_refund_moves_the_money_to_the_refund_queue(db, merchant, buyer):
    order = _merchant_delivered(db, merchant, buyer, flags=["gps_far"])
    _buyer_client(db, buyer).post(f"/orders/me/{order.id}/dispute-delivery")
    client = _admin_client(db, _admin(db))

    listed = client.get("/admin/orders", params={"delivery": "disputed"}).json()
    resp = client.post(f"/admin/orders/{order.id}/dispute", json={"decision": "refund"})

    assert [o["id"] for o in listed["items"]] == [order.id]
    assert listed["items"][0]["delivery_flagged"] is True
    assert resp.status_code == 200, resp.text
    assert resp.json()["payment_status"] == "refund_pending"
    assert resp.json()["delivery"]["dispute_resolution"] == "refund"
    txn = db.query(Transaction).filter_by(order_id=order.id).one()
    assert txn.status == TransactionStatus.REFUND_PENDING
    assert (
        db.query(AdminAuditLog).filter_by(action="order.dispute_decision").count() == 1
    )
    # A second decision is refused.
    again = client.post(
        f"/admin/orders/{order.id}/dispute", json={"decision": "release"}
    )
    assert again.status_code == 409


def test_admin_release_makes_it_payable(db, merchant, buyer):
    order = _merchant_delivered(db, merchant, buyer, flags=["gps_far"])
    _buyer_client(db, buyer).post(f"/orders/me/{order.id}/dispute-delivery")
    client = _admin_client(db, _admin(db))

    resp = client.post(
        f"/admin/orders/{order.id}/dispute", json={"decision": "release"}
    )

    assert resp.status_code == 200, resp.text
    db.expire_all()
    assert db.get(Order, order.id).dispute_resolution == "release"
    assert len(payout_service.claimable_transactions(db, merchant.id)) == 1
