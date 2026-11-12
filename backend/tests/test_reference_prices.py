"""P1a: reference price table, seed file and API."""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routes import reference_prices as routes
from app.models.reference_price import ReferencePrice
from app.services import reference_prices
from tests.test_reviews import db  # noqa: F401 - fixture


def _client(db) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_bundled_seed_rows_are_all_labelled_samples():
    rows = reference_prices.read_rows()
    assert rows, "seed file is empty"
    for row in rows:
        assert row["source"] == "SAMPLE — replace with DA Bantay Presyo data"
        assert 0 <= row["low"] <= row["high"]


def test_load_replaces_the_table(db, tmp_path):  # noqa: F811
    assert reference_prices.load(db) == len(reference_prices.read_rows())

    custom = tmp_path / "prices.csv"
    custom.write_text(
        "commodity,aliases,unit,low,high,source,as_of\n"
        "Talong,eggplant,kg,60,90,DA Bantay Presyo (NCR),2026-11-10\n",
        encoding="utf-8",
    )
    assert reference_prices.load(db, custom) == 1
    [row] = db.query(ReferencePrice).all()
    assert (row.commodity, row.low, row.high) == ("Talong", 60, 90)
    assert row.as_of == date(2026, 11, 10)
    assert not reference_prices.is_sample(row)


@pytest.mark.parametrize(
    "body",
    [
        "commodity,unit,low,high,source,as_of\nTalong,kg,1,2,X,2026-01-01\n",  # no aliases
        "commodity,aliases,unit,low,high,source,as_of\nTalong,,kg,9,2,X,2026-01-01\n",
        "commodity,aliases,unit,low,high,source,as_of\nTalong,,kg,1,2,X,yesterday\n",
        "commodity,aliases,unit,low,high,source,as_of\nTalong,,kg,1,2,,2026-01-01\n",
    ],
)
def test_bad_files_are_rejected_and_nothing_is_replaced(db, tmp_path, body):  # noqa: F811
    reference_prices.load(db)
    before = db.query(ReferencePrice).count()
    bad = tmp_path / "bad.csv"
    bad.write_text(body, encoding="utf-8")
    with pytest.raises(reference_prices.ReferencePriceFileError):
        reference_prices.load(db, bad)
    assert db.query(ReferencePrice).count() == before


def _price(commodity, aliases="", unit="kg"):
    return ReferencePrice(
        commodity=commodity,
        aliases=aliases,
        unit=unit,
        low=1,
        high=2,
        source="SAMPLE",
        as_of=date(2026, 1, 1),
    )


def test_matching_by_commodity_alias_and_unit():
    talong = _price("Talong", "eggplant")
    ampalaya = _price("Ampalaya", "bitter gourd;gourd")
    gourd = _price("Upo", "gourd")
    talong_lbs = _price("Talong", "eggplant", unit="lbs")
    prices = [talong, ampalaya, gourd, talong_lbs]

    assert reference_prices.match(prices, "Fresh Talong (Batangas)") is talong
    assert reference_prices.match(prices, "Organic EGGPLANT") is talong
    assert reference_prices.match(prices, "Bitter gourd, 1 kg pack") is ampalaya
    assert reference_prices.match(prices, "Talong", unit="lbs") is talong_lbs
    assert reference_prices.match(prices, "Talongan") is None  # whole words only
    assert reference_prices.match(prices, "Mangosteen") is None
    assert reference_prices.match(prices, None) is None


def test_api_lists_and_matches(db):  # noqa: F811
    reference_prices.load(db)
    client = _client(db)

    listed = client.get("/reference-prices").json()
    assert {p["commodity"] for p in listed} >= {"Talong", "Ampalaya", "Kamatis"}
    assert all(p["is_sample"] for p in listed)

    found = client.get("/reference-prices/match", params={"name": "Eggplant"}).json()
    assert found["commodity"] == "Talong"
    assert found["aliases"] == ["eggplant"]
    assert found["is_sample"] is True

    none = client.get("/reference-prices/match", params={"name": "Durian"})
    assert none.status_code == 200 and none.json() is None
