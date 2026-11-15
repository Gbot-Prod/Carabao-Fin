"""Deleting a BetterAuth "user" row deletes its backend account (migration
d3f7b1e9a5c2): the backend row, its cart and its merchant application go too;
a shop blocks the delete."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models.cart import Cart
from app.models.user import User
from tests.better_auth import make_user
from tests.test_buyer_deletion import _merchant
from tests.test_reviews import db  # noqa: F401 - fixture with foreign keys on


def _delete_identity(db, user):  # noqa: F811
    db.execute(text('DELETE FROM "user" WHERE id = :id'), {"id": user.external_auth_id})
    db.commit()


def test_deleting_the_auth_user_deletes_the_backend_user_and_cart(db):  # noqa: F811
    user = make_user(db, "buyer@example.com")
    db.add(Cart(user_id=user.id, items=[]))
    db.commit()
    user_id = user.id

    _delete_identity(db, user)
    db.expire_all()

    assert db.get(User, user_id) is None
    assert db.query(Cart).filter(Cart.user_id == user_id).count() == 0


def test_a_shop_blocks_the_delete(db):  # noqa: F811
    owner = make_user(db, "farmer@example.com")
    _merchant(db, owner)
    db.commit()

    with pytest.raises(IntegrityError):
        _delete_identity(db, owner)
    db.rollback()
    assert db.get(User, owner.id) is not None
