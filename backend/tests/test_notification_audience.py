"""A buyer who also owns a farm sees buyer notifications on the buyer site and
farm notifications on the merchant site, never both."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import notifications as routes
from app.models.notification import Notification
from app.services import notifications


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_audience_follows_the_link():
    a = notifications.audience_for
    assert a("/merchantDashboard") == "merchant"
    assert a("/merchantDashboard?order=4") == "merchant"
    assert a("/merchantDashboard?inquiry=2") == "merchant"
    assert a("/admin/orders") == "admin"
    assert a("/admin/support") == "admin"
    for buyer_link in ("/orders/3", "/track", "/chats?order=4", "/profile", None, ""):
        assert a(buyer_link) == "buyer"
    # Look-alikes are not merchant/admin paths.
    assert a("/merchantDashboardX") == "buyer"
    assert a("/administrator") == "buyer"


def _seed(db, user):
    notifications.notify(db, user.id, "order_paid", "Paid", link="/orders/1")
    notifications.notify(
        db, user.id, "new_order", "New order", link="/merchantDashboard"
    )
    notifications.notify(
        db, user.id, "chat_message", "Buyer wrote", link="/merchantDashboard?order=1"
    )
    notifications.notify(db, user.id, "support_message", "Help", link="/admin/support")
    db.commit()


def test_each_site_lists_and_counts_only_its_own(db, buyer):  # noqa: F811
    user, _ = buyer
    _seed(db, user)
    client = _client(db, user)

    buyer_side = client.get(
        "/users/me/notifications", params={"audience": "buyer"}
    ).json()
    assert sorted(n["title"] for n in buyer_side["items"]) == ["Help", "Paid"]
    assert buyer_side["unread"] == 2 and buyer_side["total"] == 2

    farm = client.get("/users/me/notifications", params={"audience": "merchant"}).json()
    assert sorted(n["title"] for n in farm["items"]) == ["Buyer wrote", "New order"]
    assert {n["audience"] for n in farm["items"]} == {"merchant"}
    assert farm["unread"] == 2

    # Older clients send nothing and still get everything.
    assert client.get("/users/me/notifications").json()["total"] == 4
    assert (
        client.get("/users/me/notifications", params={"audience": "admin"}).status_code
        == 422
    )


def test_mark_all_and_clear_read_stay_on_their_side(db, buyer):  # noqa: F811
    user, _ = buyer
    _seed(db, user)
    client = _client(db, user)

    assert (
        client.post(
            "/users/me/notifications/read-all", params={"audience": "merchant"}
        ).status_code
        == 204
    )
    assert (
        client.get("/users/me/notifications", params={"audience": "merchant"}).json()[
            "unread"
        ]
        == 0
    )
    assert (
        client.get("/users/me/notifications", params={"audience": "buyer"}).json()[
            "unread"
        ]
        == 2
    )

    assert (
        client.delete(
            "/users/me/notifications/read", params={"audience": "buyer"}
        ).status_code
        == 204
    )  # nothing read on the buyer side: nothing goes
    assert client.get("/users/me/notifications").json()["total"] == 4
    assert (
        client.delete(
            "/users/me/notifications/read", params={"audience": "merchant"}
        ).status_code
        == 204
    )
    left = client.get("/users/me/notifications").json()
    assert sorted(n["title"] for n in left["items"]) == ["Help", "Paid"]


def test_migration_sorts_old_rows_like_notify(db, buyer):  # noqa: F811
    user, _ = buyer
    links = [
        "/orders/1",
        "/merchantDashboard",
        "/merchantDashboard?inquiry=3",
        "/admin/orders",
        "/track",
        None,
        "/merchantDashboardX",
        "/administrator",
    ]
    for link in links:
        db.add(Notification(user_id=user.id, kind="x", title="t", link=link))
    db.commit()
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/c4e6a8b0d2f4_notification_audience.py"
    )
    spec = importlib.util.spec_from_file_location("audience_migration", path)
    assert spec and spec.loader
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    for sql in mig.BACKFILL:
        db.execute(sa.text(sql))
    db.commit()
    rows = db.query(Notification).filter_by(user_id=user.id).all()
    assert len(rows) == len(links)
    for n in rows:
        db.refresh(n)
        assert n.audience == notifications.audience_for(n.link), n.link
