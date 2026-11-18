"""CF-0050 (B51): search text is matched literally, `%` and `_` included.

The admin produce and transaction searches built ``ilike(f"%{q}%")`` without
escaping, so a search for ``_`` or ``%`` matched every row. All searches now
use ``app.core.sql.ilike_contains``.
"""

from sqlalchemy.orm import Session

from app.core.sql import contains_pattern
from app.models.merchant import Merchant
from tests import test_admin_transactions as tx
from tests import test_listing_moderation as lm
from tests.shared_fixtures import _buyer
from tests.test_admin_orders import _admin, _order


def test_pattern_escapes_wildcards_and_the_escape_char() -> None:
    assert contains_pattern("talong") == "%talong%"
    assert contains_pattern("50%") == "%50\\%%"
    assert contains_pattern("a_b") == "%a\\_b%"
    assert contains_pattern("c:\\x") == "%c:\\\\x%"


def test_admin_produce_search_is_literal(db: Session, merchant: Merchant) -> None:
    lm._listing(db, merchant, "Talong")
    sale = lm._listing(db, merchant, "Mangga 50% off")
    under = lm._listing(db, merchant, "pechay_baguio")
    client = lm._client(db, lm._staff(db))

    def names(q: str) -> list[str]:
        resp = client.get("/admin/produce", params={"q": q})
        assert resp.status_code == 200, resp.text
        return sorted(row["name"] for row in resp.json()["items"])

    assert names("%") == [sale.name]
    assert names("_") == [under.name]
    assert names("talong") == ["Talong"]


def test_admin_transaction_search_is_literal(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    a = tx._txn(db, _order(db, merchant, buyer), "paid", paymongo_payment_id="pay_A1")
    tx._txn(db, _order(db, merchant, buyer), "paid", paymongo_payment_id="payB2")
    client = tx._client(db, _admin(db))

    # Only the first id has an underscore; before, "_" matched both.
    assert tx._ids(client.get("/admin/transactions", params={"q": "_"})) == [a.id]
    assert tx._ids(client.get("/admin/transactions", params={"q": "%"})) == []
