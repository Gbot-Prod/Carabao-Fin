"""CF-0089: payout models use typed ``Mapped[...]`` columns.

The change is for mypy only. These tests make sure the schema did not move:
``mapped_column`` takes NOT NULL from the annotation when ``nullable`` is not
given, so a later ``Mapped[str]`` without ``| None`` could quietly make a
column NOT NULL (and need a migration).
"""

import pytest

from app.models.merchant import Merchant
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.transaction import Transaction
from app.models.user import User
from app.services.payout_service import PayoutError, resolve_destination

NOT_NULL = {
    PayoutBatch: {
        "id",
        "merchant_id",
        "period_date",
        "transaction_count",
        "gross_amount",
        "status",
        "attempts",
        "created_at",
    },
    PayoutBatchItem: {"id", "batch_id", "transaction_id", "amount"},
    MerchantPayoutInfo: {
        "id",
        "merchant_id",
        "payout_type",
        "verification_status",
        "created_at",
        "updated_at",
    },
}


@pytest.mark.parametrize("model", list(NOT_NULL), ids=lambda m: m.__name__)
def test_payout_model_nullability_unchanged(model):
    """CF-0089: only the columns that were NOT NULL before are NOT NULL."""
    not_null = {c.name for c in model.__table__.columns if not c.nullable}
    assert not_null == NOT_NULL[model]


def test_typed_single_columns_unchanged():
    """CF-0089: the single typed columns on shared models keep their shape."""
    for model in (User, Merchant):
        col = model.__table__.c.id
        assert col.primary_key and col.index and not col.nullable
    assert Transaction.__table__.c.merchant_amount.nullable is False


def test_resolve_destination_refuses_missing_info():
    """CF-0089: no payout method is a 400, never an AttributeError."""
    with pytest.raises(PayoutError) as err:
        resolve_destination(None)
    assert err.value.status_code == 400
