"""CF-0049 (B09): a buyer's printable receipt for a paid order.

Only the buyer of the order gets it (404 for anyone else, same as a missing
order), only once money landed on the order (409 before), and still after a
refund (with the refund status). Amounts come from the order snapshot.
"""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services.receipts import receipt_lines
from tests.shared_fixtures import _buyer
from tests.test_admin_orders import _order, _txn


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _paid_order(db: Session, merchant: Merchant, buyer: tuple[User, None]) -> Order:
    order = _order(
        db,
        merchant,
        buyer,
        ordered_at=datetime(2026, 11, 10, 9, tzinfo=UTC),
        items=[
            {"produce": "Talong", "unit": "kg", "quantity": 2, "price": 80},
            {"produce": "Mangga", "unit": "pc", "quantity": 3, "price": 50},
        ],
        delivery_fee=40,
        delivery_address="12 Rizal St, Malolos, Bulacan",
    )
    db.query(Order).filter(Order.id == order.id).update(
        {"total_price": 2 * 80 + 3 * 50 + 40}
    )
    txn = _txn(db, order, TransactionStatus.PAID)
    db.query(Transaction).filter(Transaction.id == txn.id).update(
        {
            "paymongo_payment_id": "pay_abc123",
            "paid_at": datetime(2026, 11, 10, 9, 5, tzinfo=UTC),
        }
    )
    db.commit()
    db.refresh(order)
    return order


def test_buyer_gets_the_receipt_of_a_paid_order(
    db: Session, merchant: Merchant
) -> None:
    buyer = _buyer(db)
    order = _paid_order(db, merchant, buyer)

    resp = _client(db, buyer[0]).get(f"/orders/me/{order.id}/receipt")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["receipt_number"] == f"CB-2026-{order.id:04d}"
    assert body["payment_status"] == "paid"
    assert body["payment_reference"] == "pay_abc123"
    assert body["paid_at"].startswith("2026-11-10T09:05")
    rows = [
        (r["name"], r["quantity"], r["unit_price"], r["line_total"])
        for r in body["lines"]
    ]
    assert rows == [("Talong", 2, 80, 160), ("Mangga", 3, 50, 150)]
    assert (body["subtotal"], body["delivery_fee"], body["total"]) == (310, 40, 350)
    assert body["farm_name"] == "Dela Cruz Farm"
    # Town level only: the farm's street address is not on the receipt.
    assert body["farm_town"] == "City of Malolos, Bulacan"
    assert "Purok" not in str(body)
    assert body["delivery_address"] == "12 Rizal St, Malolos, Bulacan"


def test_other_buyer_and_missing_order_get_404(
    db: Session, merchant: Merchant
) -> None:
    order = _paid_order(db, merchant, _buyer(db))
    nosy, _ = _buyer(db, "nosy@example.com")
    client = _client(db, nosy)

    assert client.get(f"/orders/me/{order.id}/receipt").status_code == 404
    assert client.get("/orders/me/9999/receipt").status_code == 404


def test_no_receipt_before_payment(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    unpaid = _order(db, merchant, buyer, status="pending")
    pending = _order(db, merchant, buyer, status="pending")
    _txn(db, pending, TransactionStatus.PENDING)
    failed = _order(db, merchant, buyer, status="cancelled")
    _txn(db, failed, TransactionStatus.FAILED)
    client = _client(db, buyer[0])

    for order in (unpaid, pending, failed):
        resp = client.get(f"/orders/me/{order.id}/receipt")
        assert resp.status_code == 409, (order.id, resp.text)


def test_receipt_stays_after_a_refund(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    order = _paid_order(db, merchant, buyer)
    db.query(Transaction).filter(Transaction.order_id == order.id).update(
        {"status": TransactionStatus.REFUNDED}
    )
    db.commit()

    body = _client(db, buyer[0]).get(f"/orders/me/{order.id}/receipt").json()

    assert body["payment_status"] == "refunded"
    assert body["total"] == 350


def test_lines_read_old_and_bad_items() -> None:
    rows = receipt_lines(
        [
            {"name": "Kamatis", "quantity": 2, "price": 30},  # pre-`produce` orders
            {"produce": "Sili", "quantity": "x", "price": None},
            "not a line",
        ]
    )
    assert [(r.name, r.quantity, r.line_total) for r in rows] == [
        ("Kamatis", 2, 60),
        ("Sili", 0, 0),
    ]
    assert receipt_lines(None) == []
