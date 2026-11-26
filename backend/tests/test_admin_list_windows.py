"""CF-0067 (B73): the admin payout and application lists come a window at a
time, newest first, and the open applications can be asked for on their own."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.api.routes import admin
from app.models.merchant_application import MerchantApplication
from app.models.payout_batch import PayoutBatch
from app.models.statuses import PayoutStatus
from app.schemas.pagination import MAX_OFFSET
from tests.shared_fixtures import _buyer
from tests.test_payouts import _admin_client


def _batches(db: Session, merchant: Any, n: int) -> list[int]:
    rows = []
    for i in range(n):
        batch = PayoutBatch(
            merchant_id=merchant.id,
            period_date=date(2026, 11, 1) + timedelta(days=i),
            gross_amount=100 + i,
            status=PayoutStatus.PENDING if i % 2 else PayoutStatus.RELEASED,
            created_at=datetime(2026, 11, 1, tzinfo=UTC) + timedelta(days=i),
        )
        db.add(batch)
        rows.append(batch)
    db.commit()
    return [int(b.id) for b in rows]


def _applications(db: Session, statuses: list[str]) -> list[int]:
    ids = []
    for i, status in enumerate(statuses):
        user, _ = _buyer(db, f"applicant{i}@example.com")
        row = MerchantApplication(
            user_id=user.id,
            status=status,
            merchant_name=f"Farm {i}",
            seller_type="individual_farmer",
            contact_email=f"applicant{i}@example.com",
            contact_number=f"63917000000{i}",
            rsbsa_document_path="rsbsa/3.pdf",
            gov_id_type="Passport",
            gov_id_document_path="gov-id/x.pdf",
            region="Region III",
            province="Bulacan",
            city="Malolos",
            address="Purok 4",
            postal_code="3000",
            available_days=["mon"],
            legal_business_name=f"Farm {i} Inc",
            barangay="Poblacion",
            submitted_at=datetime(2026, 11, 1, tzinfo=UTC) + timedelta(days=i),
        )
        db.add(row)
        db.flush()
        ids.append(int(row.id))
    db.commit()
    return ids


def test_payout_batches_window_newest_first(db: Session, merchant: Any) -> None:
    ids = _batches(db, merchant, 5)
    client = _admin_client(db)

    first = client.get("/admin/batches", params={"limit": 2}).json()
    rest = client.get("/admin/batches", params={"limit": 2, "offset": 2}).json()
    last = client.get("/admin/batches", params={"limit": 2, "offset": 4}).json()
    assert [b["id"] for b in first + rest + last] == ids[::-1]
    pending = client.get("/admin/batches", params={"status": "pending"}).json()
    assert {b["id"] for b in pending} == {ids[1], ids[3]}
    assert len(client.get("/admin/batches").json()) == 5  # default window fits

    for params in (
        {"limit": 0},
        {"limit": admin.ADMIN_LIST_MAX + 1},
        {"offset": MAX_OFFSET + 1},
    ):
        assert client.get("/admin/batches", params=params).status_code == 422, params


def test_payout_batches_page_filters_sorts_and_totals(
    db: Session, merchant: Any
) -> None:
    # gross 100..104; released at 0, 2, 4; pending at 1, 3. No fee recorded,
    # so each net is gross minus today's fee.
    ids = _batches(db, merchant, 5)
    fee = admin.transfer_fee()
    client = _admin_client(db)

    body = client.get("/admin/batches/page", params={"page_size": 2}).json()
    assert body["total"] == 5
    assert [b["id"] for b in body["items"]] == ids[::-1][:2]  # newest first
    page3 = client.get("/admin/batches/page", params={"page_size": 2, "page": 3}).json()
    assert [b["id"] for b in page3["items"]] == [ids[0]]
    assert body["summary"] == {
        "waiting": 2,
        "owed": (101 - fee) + (103 - fee),
        "released": (100 - fee) + (102 - fee) + (104 - fee),
    }

    pending = client.get("/admin/batches/page", params={"status": "pending"}).json()
    assert {b["id"] for b in pending["items"]} == {ids[1], ids[3]}
    assert pending["summary"] == body["summary"]  # totals ignore the filter

    by_amount = client.get(
        "/admin/batches/page", params={"sort": "amount", "order": "asc"}
    ).json()
    assert [b["id"] for b in by_amount["items"]] == ids

    by_id = client.get("/admin/batches/page", params={"q": f"#{ids[2]}"}).json()
    assert ids[2] in [b["id"] for b in by_id["items"]]
    by_name = client.get(
        "/admin/batches/page", params={"q": merchant.merchant_name[:4].upper()}
    ).json()
    assert by_name["total"] == 5
    none = client.get("/admin/batches/page", params={"q": "zz%no-match"}).json()
    assert none["total"] == 0 and none["items"] == []

    for params in ({"sort": "bogus"}, {"status": "approved"}, {"page": 0}):
        assert client.get("/admin/batches/page", params=params).status_code == 422, (
            params
        )


def test_applications_filter_and_window(db: Session) -> None:
    ids = _applications(
        db, ["approved", "submitted", "rejected", "clarification", "approved"]
    )
    client = _admin_client(db)
    url = "/admin/merchant-applications"

    open_ones = client.get(
        url, params={"status": ["submitted", "clarification"]}
    ).json()
    assert [a["id"] for a in open_ones] == [ids[3], ids[1]]
    page = client.get(url, params={"limit": 2, "offset": 1}).json()
    assert [a["id"] for a in page] == [ids[3], ids[2]]
    assert len(client.get(url).json()) == 5
    assert client.get(url, params={"status": "bogus"}).status_code == 422
    assert (
        client.get(url, params={"limit": admin.ADMIN_LIST_MAX + 1}).status_code == 422
    )
