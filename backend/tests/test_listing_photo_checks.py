"""Guardrails Phase 4: photo hash, QR block, price flags, vision check, and
the reference price admin routes."""

from __future__ import annotations

import io
from datetime import date, timedelta
from typing import Any

import numpy as np
import pytest
import zxingcpp
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_produce, merchants, reference_prices
from app.core.errors import FieldErrors, field_errors_handler
from app.models.admin_audit_log import AdminAuditLog
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.reference_price import ReferencePrice
from app.models.statuses import ProduceStatus
from app.models.user import User
from app.schemas.produce import PriceTier
from app.services import (
    listing_checks,
    listing_trust,
    listing_vision,
    photo_checks,
    r2_service,
)
from app.services.produce_freshness import ph_today
from tests.better_auth import make_user

TODAY = ph_today()
CDN = "https://cdn.example"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _photo(seed: int, size: tuple[int, int] = (480, 360)) -> Image.Image:
    """A photo-like image: smooth shapes, different for each seed."""
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 256, (6, 8, 3), dtype=np.uint8)
    return Image.fromarray(small).resize(size, Image.Resampling.BICUBIC)


def _jpeg(img: Image.Image, quality: int = 88) -> bytes:
    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=quality)
    return out.getvalue()


def _with_qr(img: Image.Image, text: str = "https://gcash.me/farm") -> Image.Image:
    code = zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.QRCode)
    qr = Image.fromarray(np.array(code.to_image(scale=5))).convert("RGB")
    canvas = img.convert("RGB").copy()
    canvas.paste(qr, (canvas.width - qr.width - 10, canvas.height - qr.height - 10))
    return canvas


def _client(db, user: User | None) -> TestClient:
    app = FastAPI()
    for r in (
        admin.router,
        admin_produce.router,
        merchants.router,
        reference_prices.router,
    ):
        app.include_router(r)
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _farmer(db, merchant: Merchant) -> TestClient:
    return _client(db, db.get(User, merchant.user_id))


def _staff(db) -> TestClient:
    staff = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(staff)
    db.commit()
    return _client(db, staff)


def _second_merchant(db, base: Merchant) -> Merchant:
    owner = make_user(db, "farmer2@example.com")
    db.add(owner)
    db.flush()
    other = Merchant(
        verification_status="verified",
        user_id=owner.id,
        merchant_name="Santos Farm",
        contact_number="639171234568",
        region=base.region,
        province=base.province,
        city=base.city,
        barangay=base.barangay,
        region_code=base.region_code,
        province_code=base.province_code,
        city_code=base.city_code,
        barangay_code=base.barangay_code,
        address="Purok 2",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        seller_type="individual_farmer",
        rsbsa_document_path="rsbsa/2.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/y.pdf",
    )
    db.add(other)
    db.commit()
    return other


def _listing(db, merchant: Merchant, name: str = "Talong", **extra: Any) -> Produce:
    produce = Produce(
        merchant_id=merchant.id,
        name=name,
        category="Vegetables",
        price=80,
        unit="kg",
        stock_quantity=20,
        harvest_date=TODAY - timedelta(days=1),
        best_before=TODAY + timedelta(days=5),
        **extra,
    )
    db.add(produce)
    db.commit()
    return produce


def _upload(client: TestClient, produce_id: int, data: bytes):
    return client.post(
        f"/produce/{produce_id}/image",
        files={"image": ("photo.jpg", data, "image/jpeg")},
    )


@pytest.fixture(autouse=True)
def _trusted_and_quiet(monkeypatch):
    # Only the Phase 4 rules: no new-farm review, and no real model call.
    monkeypatch.setattr(listing_trust, "NEW_MERCHANT_REVIEW_COUNT", 0)
    monkeypatch.setenv("CLOUDFLARE_R2_PUBLIC_URL", CDN)


@pytest.fixture
def r2_uploads(monkeypatch) -> list[int]:
    calls: list[int] = []

    def fake(merchant_id: int, produce_id: int, _file: Any) -> str:
        calls.append(produce_id)
        return f"{CDN}/merchants/{merchant_id}/produce/{produce_id}/{len(calls)}.jpg"

    monkeypatch.setattr(r2_service, "upload_produce_image", fake)
    return calls


# ---------------------------------------------------------------------------
# photo_checks
# ---------------------------------------------------------------------------


def test_phash_matches_a_recompressed_copy_and_not_another_photo():
    original = _photo(1)
    same = photo_checks.inspect(_jpeg(original)).phash
    smaller = photo_checks.inspect(_jpeg(original.resize((240, 180)), 60)).phash
    other = photo_checks.inspect(_jpeg(_photo(2))).phash
    assert photo_checks.distance(same, smaller) <= photo_checks.PHASH_MAX_DISTANCE
    assert photo_checks.distance(same, other) > photo_checks.PHASH_MAX_DISTANCE
    # Fits a signed 64-bit BIGINT.
    assert -(1 << 63) <= same < (1 << 63)


def test_qr_code_is_found():
    assert photo_checks.inspect(_jpeg(_with_qr(_photo(3)))).has_qr_code
    assert not photo_checks.inspect(_jpeg(_photo(3))).has_qr_code


# ---------------------------------------------------------------------------
# Upload route: QR block and the stolen-photo flag
# ---------------------------------------------------------------------------


def test_photo_with_qr_code_is_refused_before_r2(db, merchant, r2_uploads):
    produce = _listing(db, merchant)
    res = _upload(_farmer(db, merchant), produce.id, _jpeg(_with_qr(_photo(4))))
    assert res.status_code == 400, res.text
    assert res.json()["errors"] == {"image": photo_checks.QR_CODE_MESSAGE}
    assert r2_uploads == []
    db.refresh(produce)
    assert produce.image_url is None and produce.image_phash is None


def test_upload_saves_the_hash_and_stays_live(db, merchant, r2_uploads):
    produce = _listing(db, merchant)
    res = _upload(_farmer(db, merchant), produce.id, _jpeg(_photo(5)))
    assert res.status_code == 200, res.text
    db.refresh(produce)
    assert produce.image_phash is not None
    assert produce.status == ProduceStatus.LIVE


def test_photo_of_another_farm_is_flagged(db, merchant, r2_uploads):
    other = _second_merchant(db, merchant)
    first = _listing(db, merchant)
    assert _upload(_farmer(db, merchant), first.id, _jpeg(_photo(6))).status_code == 200

    copy = _listing(db, other)
    res = _upload(_farmer(db, other), copy.id, _jpeg(_photo(6), quality=70))
    assert res.status_code == 200, res.text
    db.refresh(copy)
    assert copy.status == ProduceStatus.UNDER_REVIEW
    assert [f["code"] for f in copy.review_flags] == [
        listing_checks.POSSIBLE_STOLEN_PHOTO
    ]
    # The flag stays when the farm edits the listing.
    res = _farmer(db, other).patch(f"/produce/{copy.id}", json={"stock_quantity": 9})
    assert res.status_code == 200, res.text
    assert listing_checks.POSSIBLE_STOLEN_PHOTO in [
        f["code"] for f in res.json()["review_flags"]
    ]


def test_farm_may_use_its_own_photo_again(db, merchant, r2_uploads):
    client = _farmer(db, merchant)
    a = _listing(db, merchant, "Talong")
    b = _listing(db, merchant, "Talong na mahaba")
    assert _upload(client, a.id, _jpeg(_photo(7))).status_code == 200
    assert _upload(client, b.id, _jpeg(_photo(7))).status_code == 200
    db.refresh(b)
    assert b.status == ProduceStatus.LIVE and b.review_flags == []


def test_removing_the_photo_clears_hash_and_check(db, merchant, r2_uploads):
    produce = _listing(db, merchant)
    client = _farmer(db, merchant)
    assert _upload(client, produce.id, _jpeg(_photo(8))).status_code == 200
    db.refresh(produce)
    produce.photo_check = {"key": "x"}
    db.commit()
    res = client.patch(f"/produce/{produce.id}", json={"image_url": ""})
    assert res.status_code == 200, res.text
    db.refresh(produce)
    assert produce.image_url is None
    assert produce.image_phash is None and produce.photo_check is None


# ---------------------------------------------------------------------------
# Price flags
# ---------------------------------------------------------------------------


def _ref(
    low: int = 60,
    high: int = 100,
    *,
    source: str = "DA Daily Price Index NCR",
    as_of: date | None = None,
    unit: str = "kg",
) -> ReferencePrice:
    return ReferencePrice(
        commodity="Talong",
        aliases="eggplant",
        unit=unit,
        low=low,
        high=high,
        source=source,
        as_of=as_of or TODAY - timedelta(days=2),
    )


def _price_codes(rows: list[ReferencePrice], **listing: Any) -> list[str]:
    body: dict[str, Any] = {"name": "Talong", "price": 80, "unit": "kg"}
    body.update(listing)
    result = listing_checks.run_checks(
        listing_checks.ListingInput(**body),
        reference_rows=rows,
        reference_is_real=True,
        today=TODAY,
    )
    return [
        i.code
        for i in result.soft_flags
        if i.code in (listing_checks.PRICE_TOO_LOW, listing_checks.PRICE_TOO_HIGH)
    ]


def test_price_far_below_or_above_the_market_is_flagged():
    rows = [_ref()]
    assert _price_codes(rows, price=80) == []
    assert _price_codes(rows, price=1) == [listing_checks.PRICE_TOO_LOW]
    assert _price_codes(rows, price=800) == [listing_checks.PRICE_TOO_HIGH]
    # 30 pesos for 0.5 kg is 60 per kg: inside the band.
    assert _price_codes(rows, price=30, unit_quantity=0.5) == []
    # 20 pesos per lb is about 44 per kg: above 0.5 x 60.
    assert _price_codes(rows, price=20, unit="lbs") == []
    # 10 pesos per lb is about 22 per kg: below 0.5 x 60.
    assert _price_codes(rows, price=10, unit="lbs") == [listing_checks.PRICE_TOO_LOW]


def test_bait_price_in_a_tier_is_flagged_on_the_tier():
    result = listing_checks.run_checks(
        listing_checks.ListingInput(
            name="Talong",
            price=80,
            unit="kg",
            price_tiers=(PriceTier(min_qty=5, unit_price=20),),
        ),
        reference_rows=[_ref()],
        reference_is_real=True,
        today=TODAY,
    )
    low = [i for i in result.soft_flags if i.code == listing_checks.PRICE_TOO_LOW]
    assert [i.field for i in low] == ["price_tiers"]


def test_price_flags_stay_off_without_usable_real_data():
    sample = [_ref(source="SAMPLE - replace with DA data")]
    stale = [
        _ref(as_of=TODAY - timedelta(days=listing_checks.REFERENCE_MAX_AGE_DAYS + 1))
    ]
    per_piece = [_ref(unit="pc")]
    for rows in (sample, stale, per_piece, []):
        assert _price_codes(rows, price=1) == []


# ---------------------------------------------------------------------------
# Vision check
# ---------------------------------------------------------------------------


@pytest.fixture
def vision_on(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(
        listing_vision, "_download", lambda url: (_jpeg(_photo(9)), "image/jpeg")
    )
    answers: list[dict[str, Any]] = []

    def fake_model(image, media_type, name, category):
        assert media_type == "image/jpeg" and image
        return answers.pop(0)

    monkeypatch.setattr(listing_vision, "call_model", fake_model)
    return answers


def _queued(db, merchant: Merchant) -> Produce:
    produce = _listing(
        db,
        merchant,
        image_url=f"{CDN}/merchants/{merchant.id}/produce/1/a.jpg",
        status=ProduceStatus.UNDER_REVIEW,
        review_flags=[{"field": "name", "code": "X", "message": "m"}],
    )
    return produce


MISMATCH = {
    "shows_named_produce": "no",
    "detected_produce": "a mobile phone",
    "has_contact_text": True,
    "note": "Photo of a phone screen with a number.",
}


def test_vision_is_off_without_a_key(db, merchant, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert not listing_vision.needs_check(_queued(db, merchant))


def test_vision_adds_advisory_flags_to_a_queued_listing(db, merchant, vision_on):
    produce = _queued(db, merchant)
    vision_on.append(dict(MISMATCH))
    assert listing_vision.run_check(db, produce.id)
    db.refresh(produce)
    codes = [f["code"] for f in produce.review_flags]
    assert codes == [
        "X",
        listing_vision.VISION_MISMATCH,
        listing_vision.VISION_CONTACT_TEXT,
    ]
    assert produce.status == ProduceStatus.UNDER_REVIEW
    assert produce.photo_check["model"] == listing_vision.MODEL
    # Once for each photo, name and category.
    assert not listing_vision.needs_check(produce)
    assert not listing_vision.run_check(db, produce.id)


def test_vision_never_touches_a_live_listing(db, merchant, vision_on):
    produce = _listing(
        db, merchant, image_url=f"{CDN}/merchants/{merchant.id}/produce/1/a.jpg"
    )
    assert not listing_vision.needs_check(produce)
    assert not listing_vision.run_check(db, produce.id)


def test_vision_result_is_dropped_when_the_listing_changed(
    db, merchant, vision_on, monkeypatch
):
    produce = _queued(db, merchant)

    def changed_meanwhile(image, media_type, name, category):
        row = db.get(Produce, produce.id)
        row.name = "Kamatis"
        db.commit()
        return dict(MISMATCH)

    monkeypatch.setattr(listing_vision, "call_model", changed_meanwhile)
    assert not listing_vision.run_check(db, produce.id)
    db.refresh(produce)
    assert produce.photo_check is None


def test_admin_approval_clears_vision_flags_for_good(db, merchant, vision_on):
    produce = _queued(db, merchant)
    vision_on.append(dict(MISMATCH))
    listing_vision.run_check(db, produce.id)

    staff = _staff(db)
    res = staff.post(f"/admin/produce/{produce.id}/approve")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["photo_check"]["cleared"] is True
    assert body["photo_check"]["detected_produce"] == "a mobile phone"
    db.refresh(produce)
    assert produce.status == ProduceStatus.LIVE

    # A big price edit is a material edit; the approved photo stays clean.
    res = _farmer(db, merchant).patch(f"/produce/{produce.id}", json={"price": 150})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == ProduceStatus.LIVE.value


def test_upload_to_a_queued_listing_schedules_the_check(
    db, merchant, r2_uploads, monkeypatch
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    scheduled: list[int] = []
    monkeypatch.setattr(listing_vision, "run_check_in_background", scheduled.append)
    produce = _listing(
        db,
        merchant,
        status=ProduceStatus.UNDER_REVIEW,
        review_flags=[{"field": "name", "code": "X", "message": "m"}],
    )
    # The listing has no flag of its own, so the new-farm review keeps it queued.
    monkeypatch.setattr(listing_trust, "NEW_MERCHANT_REVIEW_COUNT", 3)
    res = _upload(_farmer(db, merchant), produce.id, _jpeg(_photo(10)))
    assert res.status_code == 200, res.text
    assert scheduled == [produce.id]

    # A live listing gets no check.
    monkeypatch.setattr(listing_trust, "NEW_MERCHANT_REVIEW_COUNT", 0)
    live = _listing(db, merchant, "Okra")
    scheduled.clear()
    assert _upload(_farmer(db, merchant), live.id, _jpeg(_photo(11))).status_code == 200
    assert scheduled == []


# ---------------------------------------------------------------------------
# Reference price admin routes
# ---------------------------------------------------------------------------

CSV_HEADER = "commodity,aliases,unit,low,high,source,as_of\n"


def _csv(text: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": ("prices.csv", text.encode("utf-8"), "text/csv")}


def test_import_turns_the_price_flags_on(db):
    staff = _staff(db)
    status = staff.get("/admin/reference-prices/status")
    assert status.status_code == 200, status.text
    assert status.json()["price_flags_active"] is False

    body = CSV_HEADER + (
        f"Talong,eggplant,kg,60,100,DA Daily Price Index NCR,{TODAY.isoformat()}\n"
        f"Kamatis,tomato,kg,50,90,DA Daily Price Index NCR,{TODAY.isoformat()}\n"
    )
    res = staff.post("/admin/reference-prices/import", files=_csv("﻿" + body))
    assert res.status_code == 200, res.text
    assert res.json()["real"] == 2 and res.json()["price_flags_active"] is True
    assert db.query(ReferencePrice).count() == 2
    assert (
        db.query(AdminAuditLog).filter_by(action="reference_prices.import").count() == 1
    )


def test_bad_import_changes_nothing(db):
    db.add(_ref())
    db.commit()
    staff = _staff(db)
    for text in (
        CSV_HEADER + "Talong,,kg,100,50,DA,2026-11-01\n",  # low > high
        CSV_HEADER
        + "Talong,,kg,60,100,DA,2026-11-01\nTalong,,kg,60,90,DA,2026-11-01\n",
        CSV_HEADER,  # no rows
        "commodity,low\nTalong,60\n",  # missing columns
    ):
        res = staff.post("/admin/reference-prices/import", files=_csv(text))
        assert res.status_code == 422, (text, res.text)
    assert db.query(ReferencePrice).count() == 1


def test_reference_admin_routes_need_an_admin(db, merchant):
    farmer = _farmer(db, merchant)
    assert farmer.get("/admin/reference-prices/status").status_code in (401, 403)
    res = farmer.post("/admin/reference-prices/import", files=_csv(CSV_HEADER))
    assert res.status_code in (401, 403)
