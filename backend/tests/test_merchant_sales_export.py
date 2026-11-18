"""CF-0055 (B12): the merchant's sales as a CSV file.

Same orders as the dashboard charts (money received, not cancelled, Manila
days), one row per order line, only the caller's farm, no buyer details, and
cells that can't run as spreadsheet formulas.
"""

import csv
import io

from sqlalchemy.orm import Session

from app.api.routes.merchant_sales import EXPORT_COLUMNS
from app.core.csv_export import csv_cell
from app.models.merchant import Merchant
from app.models.user import User
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant
from tests.test_merchant_sales import _client, _order


def _rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def _owner(db: Session, merchant: Merchant) -> User:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    return owner


def test_export_has_one_row_per_line_of_counted_orders(
    db: Session, merchant: Merchant
) -> None:
    buyer = _buyer(db, "ana@example.com", "Ana Santos")
    _order(
        db,
        merchant,
        buyer,
        360,
        [
            {
                "produce_id": 1,
                "produce": "Talong",
                "unit": "kg",
                "quantity": 2,
                "price": 80,
            },
            {
                "produce_id": 2,
                "produce": "Mangga",
                "unit": "pc",
                "quantity": 4,
                "price": 50,
            },
        ],
        days_ago=1,
    )
    _order(
        db,
        merchant,
        buyer,
        99,
        [{"name": "Unpaid", "quantity": 1, "price": 99}],
        days_ago=1,
        paid=False,
    )
    _order(
        db,
        merchant,
        buyer,
        50,
        [{"name": "Cancelled", "quantity": 1, "price": 50}],
        days_ago=1,
        status="cancelled",
    )
    _order(
        db,
        merchant,
        buyer,
        70,
        [{"name": "Too old", "quantity": 1, "price": 70}],
        days_ago=40,
    )

    resp = _client(db, _owner(db, merchant)).get("/merchants/me/sales/export?days=30")

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv")
    assert 'filename="sales-30d-' in resp.headers["content-disposition"]
    rows = _rows(resp.text)
    assert list(rows[0]) == EXPORT_COLUMNS
    assert [
        (r["produce"], r["quantity"], r["unit_price"], r["line_total"]) for r in rows
    ] == [
        ("Talong", "2", "80", "160"),
        ("Mangga", "4", "50", "200"),
    ]
    assert {r["order_total"] for r in rows} == {"360"}
    assert rows[0]["order_ref"].startswith("CB-")
    assert rows[0]["ordered_at_manila"].endswith("+08:00")
    # No buyer details in the file.
    assert "Ana" not in resp.text and "ana@example.com" not in resp.text


def test_export_window_matches_the_tabs(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    _order(
        db,
        merchant,
        buyer,
        70,
        [{"name": "Talong", "quantity": 1, "price": 70}],
        days_ago=10,
    )
    client = _client(db, _owner(db, merchant))

    assert _rows(client.get("/merchants/me/sales/export?days=7").text) == []
    assert len(_rows(client.get("/merchants/me/sales/export?days=30").text)) == 1
    assert client.get("/merchants/me/sales/export?days=14").status_code == 422


def test_export_is_only_the_callers_farm(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    rival = _other_merchant(db)
    _order(
        db,
        rival,
        buyer,
        70,
        [{"name": "Rival sale", "quantity": 1, "price": 70}],
        days_ago=1,
    )

    mine = _client(db, _owner(db, merchant)).get("/merchants/me/sales/export").text
    assert _rows(mine) == []
    # A buyer with no farm gets 404, not someone's sales.
    assert _client(db, buyer[0]).get("/merchants/me/sales/export").status_code == 404


def test_bad_price_order_is_left_out_whole(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    _order(
        db,
        merchant,
        buyer,
        70,
        [
            {"name": "Good", "quantity": 1, "price": 70},
            {"name": "Broken", "quantity": 1, "price": "abc"},
        ],
        days_ago=1,
    )

    resp = _client(db, _owner(db, merchant)).get("/merchants/me/sales/export")

    assert resp.status_code == 200
    assert _rows(resp.text) == []


def test_cells_cannot_run_as_formulas(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    _order(
        db,
        merchant,
        buyer,
        70,
        [
            {"produce": '=HYPERLINK("http://x")', "quantity": 1, "price": 70},
        ],
        days_ago=1,
    )

    (row,) = _rows(
        _client(db, _owner(db, merchant)).get("/merchants/me/sales/export").text
    )

    assert row["produce"].startswith("'=")
    assert (
        csv_cell("@SUM(1)") == "'@SUM(1)"
        and csv_cell(None) == ""
        and csv_cell(5) == "5"
    )
