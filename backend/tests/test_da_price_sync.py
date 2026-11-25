"""Guardrails Phase 4: reference prices from the DA Price Index API."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import reference_prices as routes
from app.models.admin_audit_log import AdminAuditLog
from app.models.reference_price import ReferencePrice
from app.services import da_price_sync as sync
from app.services import listing_checks as lc
from app.services import reference_prices
from tests.better_auth import make_user

DAY = "2026-11-24"


def _item(name, price, category="LOWLAND VEGETABLES", unit="kg", **extra):
    return {
        "commodity_id": abs(hash(name)) % 10_000,
        "commodity_name": name,
        "top_category": category,
        "unit": unit,
        "report_date": DAY,
        "price_prevailing": None if price is None else f"{price:.2f}",
        "is_available": price is not None,
        "quality": {"drift_flagged": extra.pop("drift", False), "drift_pct": 0.0},
        **extra,
    }


def _body(*items):
    return {"region_code": "NCR", "as_of_date": DAY, "items": list(items)}


SAMPLE_REPORT = _body(
    _item("Banana (Lakatan)", 93.65, "FRUITS"),
    _item("Banana (Saba)", 66.93, "FRUITS"),
    _item("Bitter Gourd (Ampalaya)", 104.21),
    _item("Tomato", 114.12),
    _item("Native Pechay", 84.15),
    _item("Pechay Baguio, Local", 85.84, "HIGHLAND VEGETABLES"),
    _item("Cabbage (Rare Ball), Local", 106.75, "HIGHLAND VEGETABLES"),
    _item("Cabbage, Imported", None, "HIGHLAND VEGETABLES"),
    _item("Jute Leaves/Spinach (Saluyot)", 92.45),
    _item("Chilli (Green), Local", 131.93),
    _item("Chilli (Red), Local", 218.61, "SPICES"),
    _item("Corn (White)", 105.60, "CORN PRODUCTS"),
    _item("Corn Grits (White, Food Grade)", 100.0, "CORN PRODUCTS"),
    _item("Eggplant", 107.64, unit="pc"),
    _item("Okra", 120.0, drift=True),
    _item("Pork Belly", 380.0, "LIVESTOCK & POULTRY PRODUCTS"),
    _item("Well Milled", 49.0, "LOCAL COMMERCIAL RICE"),
)


def _by_name(rows):
    return {r["commodity"]: r for r in rows}


def test_build_groups_variants_and_skips_non_produce():
    rows, stats = sync.build_rows(SAMPLE_REPORT)
    got = _by_name(rows)

    assert set(got) == {
        "Banana",
        "Bitter Gourd",
        "Tomato",
        "Pechay",
        "Pechay Baguio",
        "Cabbage",
        "Saluyot",
        "Green Chili",
        "Red Chili",
        "Corn",
    }
    banana = got["Banana"]
    assert (banana["low"], banana["high"]) == (66, 94)  # floor of min, ceil of max
    assert banana["unit"] == "kg"
    assert banana["source"] == "DA Daily Price Index NCR"
    assert banana["as_of"] == date(2026, 11, 24)
    assert stats == {"unavailable": 1, "drift": 1, "unit": ["Eggplant (pc)"]}
    # Rows the CSV loader accepts.
    for row in rows:
        assert 0 <= row["low"] <= row["high"]


def test_aliases_hold_local_names_and_no_bare_colors():
    rows, _ = sync.build_rows(SAMPLE_REPORT)
    aliases = {r["commodity"]: set(r["aliases"].split(";")) for r in rows}

    assert {"ampalaya", "amargoso"} <= aliases["Bitter Gourd"]
    assert {"saba", "lakatan", "saging"} <= aliases["Banana"]
    assert "spinach" not in aliases["Saluyot"]
    for names in aliases.values():
        assert not names & {"red", "green", "white", "yellow", "local", "imported"}


@pytest.mark.parametrize(
    ("listing", "expected"),
    [
        ("Saba banana", "Banana"),
        ("Fresh Ampalaya", "Bitter Gourd"),
        ("Kamatis", "Tomato"),
        ("Napa cabbage", "Pechay Baguio"),
        ("Repolyo", "Cabbage"),
        ("Siling labuyo", "Red Chili"),
        ("Mais", "Corn"),
        ("Spinach", None),
        ("Red lady papaya", None),
    ],
)
def test_listing_names_match_the_right_group(listing, expected):
    rows, _ = sync.build_rows(SAMPLE_REPORT)
    found = reference_prices.match([ReferencePrice(**r) for r in rows], listing, "kg")
    assert (found.commodity if found else None) == expected


def test_sync_replaces_samples_and_old_da_rows_but_keeps_admin_rows(db, monkeypatch):
    monkeypatch.setattr(sync, "MIN_GROUPS", 1)
    reference_prices.load(db)  # SAMPLE seed rows
    db.add_all(
        [
            ReferencePrice(
                commodity="Kangkong",
                aliases="water spinach",
                unit="kg",
                low=40,
                high=60,
                source="Admin survey",
                as_of=date(2026, 11, 20),
            ),
            # An admin row for a produce that DA now has: DA wins.
            ReferencePrice(
                commodity="Tomato",
                aliases="",
                unit="kg",
                low=1,
                high=2,
                source="Admin survey",
                as_of=date(2026, 11, 20),
            ),
            ReferencePrice(
                commodity="Okra",
                aliases="",
                unit="kg",
                low=100,
                high=110,
                source="DA Daily Price Index NCR",
                as_of=date(2026, 11, 20),
            ),
        ]
    )
    db.commit()

    result = sync.sync(db, body=SAMPLE_REPORT)

    rows = {r.commodity: r for r in db.query(ReferencePrice).all()}
    assert result.groups == 10 and result.rows_kept == 1
    assert "Kangkong" in rows  # kept
    # The admin row says kangkong, so the in-house Water Spinach row stays out.
    assert "Water Spinach" not in rows
    assert result.inhouse_overlap == ["Water Spinach"]
    assert rows["Moringa"].source.startswith("Carabao in-house")
    assert "Talong" not in rows  # SAMPLE row gone
    assert "Okra" not in rows  # old DA row gone (today drift flagged)
    assert rows["Tomato"].source == "DA Daily Price Index NCR"
    assert not any(reference_prices.is_sample(r) for r in rows.values())


def test_a_thin_report_changes_nothing(db):
    reference_prices.load(db)
    before = db.query(ReferencePrice).count()
    with pytest.raises(sync.DaPriceSyncError):
        sync.sync(db, body=SAMPLE_REPORT)  # 10 groups < MIN_GROUPS
    assert db.query(ReferencePrice).count() == before


def test_synced_rows_turn_the_price_flags_on(db, monkeypatch):
    monkeypatch.setattr(sync, "MIN_GROUPS", 1)
    sync.sync(db, body=SAMPLE_REPORT)
    rows = db.query(ReferencePrice).all()

    bait = lc.run_checks(
        lc.ListingInput(name="Kamatis", price=5, unit="kg", unit_quantity=1),
        reference_rows=rows,
        reference_is_real=True,
        today=date(2026, 11, 25),
    )
    assert ("price", lc.PRICE_TOO_LOW) in {(i.field, i.code) for i in bait.soft_flags}

    fair = lc.run_checks(
        lc.ListingInput(name="Kamatis", price=90, unit="kg", unit_quantity=1),
        reference_rows=rows,
        reference_is_real=True,
        today=date(2026, 11, 25),
    )
    assert fair.soft_flags == []


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_admin_sync_route_writes_rows_and_audit(db, monkeypatch):
    monkeypatch.setattr(sync, "MIN_GROUPS", 1)
    monkeypatch.setattr(sync, "fetch_latest", lambda region: SAMPLE_REPORT)
    staff = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(staff)
    db.commit()

    res = _client(db, staff).post("/admin/reference-prices/sync-da")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["groups"] == 10
    assert body["skipped_unit"] == ["Eggplant (pc)"]
    assert body["status"]["price_flags_active"] is True
    assert (
        db.query(AdminAuditLog).filter_by(action="reference_prices.sync_da").count()
        == 1
    )


def test_admin_sync_route_reports_an_api_failure(db, monkeypatch):
    def down(region):
        raise sync.DaPriceSyncError("DA price API is not available")

    monkeypatch.setattr(sync, "fetch_latest", down)
    staff = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(staff)
    db.commit()

    res = _client(db, staff).post("/admin/reference-prices/sync-da")
    assert res.status_code == 502
    assert db.query(ReferencePrice).count() == 0


def test_admin_sync_route_needs_an_admin(db):
    farmer = make_user(db, "farmer@example.com")
    db.add(farmer)
    db.commit()
    res = _client(db, farmer).post("/admin/reference-prices/sync-da")
    assert res.status_code in (401, 403)


# ---------------------------------------------------------------------------
# In-house rows (app/data/inhouse_reference_prices.csv)
# ---------------------------------------------------------------------------

BARE_WORDS = {"red", "green", "white", "yellow", "dilaw", "pula", "local", "imported"}


def test_inhouse_file_is_valid_and_does_not_tie_with_da_names():
    rows = sync.read_inhouse()
    assert rows
    da_names = {reference_prices.norm_name(g) for g in sync.GROUP_ALIASES}
    for aliases in sync.GROUP_ALIASES.values():
        da_names |= {reference_prices.norm_name(a) for a in aliases}
    seen: set[str] = set()
    for row in rows:
        names = sync._row_names(row)
        assert row["source"].startswith(sync.INHOUSE_SOURCE_PREFIX)
        assert row["unit"] in ("kg", "pc")
        assert not names & BARE_WORDS, row["commodity"]
        # Eggplant is in DA (per pc now, a parser error), so it may overlap.
        if row["commodity"] != "Eggplant":
            assert not names & da_names, (row["commodity"], names & da_names)
        assert not names & seen, (row["commodity"], names & seen)
        seen |= names


def test_da_eggplant_replaces_the_inhouse_eggplant():
    report = _body(*SAMPLE_REPORT["items"], _item("Eggplant (Talong)", 98.0))
    da_rows, _ = sync.build_rows(report)
    merged, overlap = sync.merge_inhouse(da_rows, sync.read_inhouse())
    assert "Eggplant" in overlap
    [eggplant] = [r for r in merged if r["commodity"] == "Eggplant"]
    assert eggplant["source"] == "DA Daily Price Index NCR"


def test_inhouse_rows_stay_usable_longer_than_da_rows():
    today = date(2026, 11, 25)
    old = date(2026, 8, 1)  # 116 days
    da = ReferencePrice(
        commodity="Tomato",
        aliases="",
        unit="kg",
        low=1,
        high=2,
        source="DA Daily Price Index NCR",
        as_of=old,
    )
    inhouse = ReferencePrice(
        commodity="Taro",
        aliases="gabi",
        unit="kg",
        low=1,
        high=2,
        source="Carabao in-house estimate (NCR retail)",
        as_of=old,
    )
    assert lc.usable_reference_rows([da, inhouse], today) == [inhouse]


def test_farm_price_below_ncr_retail_is_not_flagged(db, monkeypatch):
    monkeypatch.setattr(sync, "MIN_GROUPS", 1)
    sync.sync(db, body=SAMPLE_REPORT)
    rows = db.query(ReferencePrice).all()
    # Tomato NCR 114: a farm price of 45 (about 40%) is normal.
    result = lc.run_checks(
        lc.ListingInput(name="Kamatis", price=45, unit="kg", unit_quantity=1),
        reference_rows=rows,
        reference_is_real=True,
        today=date(2026, 11, 25),
    )
    assert result.soft_flags == []
    # Kangkong has an in-house row, so it is not "unknown produce".
    kangkong = lc.run_checks(
        lc.ListingInput(name="Fresh kangkong", price=50, unit="kg", unit_quantity=1),
        reference_rows=rows,
        reference_is_real=True,
        today=date(2026, 11, 25),
    )
    assert kangkong.soft_flags == []


# ---------------------------------------------------------------------------
# Scheduled sync (main.py loop)
# ---------------------------------------------------------------------------


@pytest.fixture
def scheduled(monkeypatch):
    calls = []

    def fetch(region):
        calls.append(region)
        return SAMPLE_REPORT

    monkeypatch.setenv("DA_PRICE_SYNC_HOURS", "6")
    monkeypatch.setattr(sync, "MIN_GROUPS", 1)
    monkeypatch.setattr(sync, "fetch_latest", fetch)
    monkeypatch.setattr(sync, "_next_attempt", 0.0)
    return calls


def test_scheduled_sync_runs_when_due_only(db, scheduled):
    from datetime import UTC, datetime, timedelta

    assert sync.sync_if_due(db) is not None
    assert len(scheduled) == 1
    assert db.query(AdminAuditLog).filter_by(admin_email="system").count() == 1

    # The audit row is new: not due.
    assert sync.sync_if_due(db) is None
    assert len(scheduled) == 1

    later = datetime.now(UTC) + timedelta(hours=7)
    assert sync.sync_if_due(db, now=later) is not None
    assert len(scheduled) == 2


def test_scheduled_sync_is_off_at_zero_hours(db, scheduled, monkeypatch):
    monkeypatch.setenv("DA_PRICE_SYNC_HOURS", "0")
    assert sync.sync_if_due(db) is None
    assert scheduled == []


def test_failed_scheduled_sync_waits_before_a_retry(db, scheduled, monkeypatch):
    def down(region):
        scheduled.append(region)
        raise sync.DaPriceSyncError("down")

    monkeypatch.setattr(sync, "fetch_latest", down)
    assert sync.sync_if_due(db) is None
    assert sync.sync_if_due(db) is None  # inside RETRY_SECONDS: no call
    assert len(scheduled) == 1
    assert db.query(ReferencePrice).count() == 0
