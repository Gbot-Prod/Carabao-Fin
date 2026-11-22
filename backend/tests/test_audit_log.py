"""A4: every admin action is logged with who, when, before and after."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_accounts, admin_audit, admin_orders
from app.models.admin_audit_log import AdminAuditLog
from app.models.merchant_application import MerchantApplication
from app.models.user import User
from app.services import admin_accounts as admin_accounts_service
from app.services import refund_service
from tests.better_auth import make_user
from tests.test_admin_orders import _order, _txn
from tests.test_payouts import _env, _requested_batch, transfers  # noqa: F401
from tests.test_reviews import _buyer


def _client(db, user) -> TestClient:
    app = FastAPI()
    for r in (
        admin.router,
        admin_accounts.router,
        admin_audit.router,
        admin_orders.router,
    ):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _staff(db, email="admin@example.com") -> User:
    staff = make_user(db, email, is_admin=True, notifications_preferences={})
    db.add(staff)
    db.commit()
    return staff


def _entries(db, action=None):
    q = db.query(AdminAuditLog)
    if action:
        q = q.filter(AdminAuditLog.action == action)
    return q.order_by(AdminAuditLog.id).all()


def test_admin_invite_is_logged(db, merchant, monkeypatch):
    # The invite email is captured, not sent.
    monkeypatch.setattr(
        admin_accounts_service, "send_admin_invite_email", lambda *a, **k: None
    )
    staff = _staff(db)
    res = _client(db, staff).post(
        "/admin/invites", json={"email": "new-admin@example.com", "name": "Ana"}
    )
    assert res.status_code == 201, res.text
    [entry] = _entries(db, "admin.invite")
    assert entry.admin_id == staff.id and entry.admin_email == "admin@example.com"
    assert entry.target_type == "user" and entry.target_id == res.json()["user"]["id"]
    assert entry.after["email"] == "new-admin@example.com"
    # The code is never in the log.
    assert res.json()["code"].replace("-", "") not in str(entry.after)
    assert entry.created_at is not None


def test_suspend_and_reinstate_are_logged(db, merchant):
    staff = _staff(db)
    target, _ = _buyer(db)
    client = _client(db, staff)
    client.post(f"/admin/users/{target.id}/suspend", json={"reason": "Spam"})
    client.post(f"/admin/users/{target.id}/reinstate")
    suspend, reinstate = _entries(db)
    assert suspend.action == "user.suspend"
    assert suspend.before["is_suspended"] is False
    assert suspend.after["suspension_reason"] == "Spam"
    assert reinstate.action == "user.reinstate"
    assert reinstate.before["suspension_reason"] == "Spam"
    assert reinstate.after == {"is_suspended": False, "suspension_reason": None}


def test_application_review_is_logged(db, merchant):
    staff = _staff(db)
    applicant, _ = _buyer(db, email="applicant@example.com")
    application = MerchantApplication(
        user_id=applicant.id,
        status="submitted",
        merchant_name="Applicant Farm",
        legal_business_name="Applicant Farm",
        barangay="Santo Rosario",
        seller_type="individual_farmer",
        contact_email="applicant@example.com",
        contact_number="639170000001",
        rsbsa_document_path="rsbsa/3.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="Purok 4",
        postal_code="3000",
        available_days=["mon"],
    )
    db.add(application)
    db.commit()
    res = _client(db, staff).patch(
        f"/admin/merchant-applications/{application.id}",
        json={"status": "clarification", "admin_note": "Upload a clearer RSBSA"},
    )
    assert res.status_code == 200, res.text
    [entry] = _entries(db, "merchant_application.review")
    assert entry.before["status"] == "submitted"
    assert entry.after["status"] == "clarification"
    assert entry.after["admin_note"] == "Upload a clearer RSBSA"


def test_refund_is_logged_and_failed_refund_is_not(db, merchant, monkeypatch):
    monkeypatch.setattr(refund_service, "notify_buyer_refunded", lambda txn: None)
    staff = _staff(db)
    txn = _txn(db, _order(db, merchant, _buyer(db), "cancelled"), "refund_pending")
    client = _client(db, staff)
    payload = {"method": "gcash", "reference": "GC-1"}
    assert client.post(f"/admin/refunds/{txn.id}", json=payload).status_code == 200
    assert client.post(f"/admin/refunds/{txn.id}", json=payload).status_code == 409
    [entry] = _entries(db, "transaction.refund")
    assert entry.target_id == txn.id
    assert entry.before == {"status": "refund_pending"}
    assert entry.after["status"] == "refunded"
    assert entry.after["refund_reference"] == "GC-1"


def test_payout_release_is_logged(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    staff = _staff(db, email="payouts-admin@example.com")
    res = _client(db, staff).patch(f"/admin/batches/{batch['id']}/release")
    assert res.status_code == 200, res.text
    [entry] = _entries(db, "payout.release")
    assert entry.target_type == "payout_batch" and entry.target_id == batch["id"]
    assert entry.before["status"] == "pending"
    assert entry.after["status"] == "processing"
    assert entry.after["paymongo_transfer_id"] == "tr_1"


def test_log_endpoint_is_admin_only_newest_first_and_filterable(db, merchant):
    staff = _staff(db)
    target, _ = _buyer(db)
    client = _client(db, staff)
    client.post(f"/admin/users/{target.id}/suspend", json={"reason": "Spam"})
    client.post(f"/admin/users/{target.id}/reinstate")

    body = client.get("/admin/audit-log").json()
    assert body["total"] == 2
    assert [e["action"] for e in body["items"]] == ["user.reinstate", "user.suspend"]

    only = client.get("/admin/audit-log?action=user.suspend").json()
    assert [e["action"] for e in only["items"]] == ["user.suspend"]
    assert client.get(f"/admin/audit-log?target_id={target.id}").json()["total"] == 2
    assert "payout.release" in client.get("/admin/audit-log/actions").json()

    non_admin = _client(db, _buyer(db, email="nosy@example.com")[0])
    assert non_admin.get("/admin/audit-log").status_code == 403


def test_approval_records_the_admin_and_copies_the_gov_id(db, merchant):
    from app.models.merchant import Merchant

    staff = _staff(db)
    applicant, _ = _buyer(db, email="approved@example.com")
    application = MerchantApplication(
        user_id=applicant.id,
        status="submitted",
        merchant_name="Approved Farm",
        legal_business_name="Approved Farm",
        barangay="Santo Rosario",
        seller_type="individual_farmer",
        contact_email="approved@example.com",
        contact_number="+639170000009",
        rsbsa_document_path="rsbsa/9.pdf",
        gov_id_type="UMID",
        gov_id_document_path="gov-id/9.pdf",
        gov_id_document_original_name="umid.pdf",
        gov_id_document_content_type="application/pdf",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="Purok 4",
        postal_code="3000",
        available_days=["Mon"],
    )
    db.add(application)
    db.commit()
    res = _client(db, staff).patch(
        f"/admin/merchant-applications/{application.id}",
        json={"status": "approved"},
    )
    assert res.status_code == 200, res.text
    db.refresh(application)
    assert application.reviewed_by_user_id == staff.id
    assert application.reviewed_at is not None
    shop = db.get(Merchant, application.merchant_id)
    assert shop.gov_id_type == "UMID"
    assert shop.gov_id_document_path == "gov-id/9.pdf"
    assert shop.gov_id_document_original_name == "umid.pdf"
    assert shop.verified_by_user_id == staff.id
    assert shop.verified_at is not None
