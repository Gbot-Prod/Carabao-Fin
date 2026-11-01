from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.transaction import Transaction
from app.models.user import User

ACTIVE_ORDER_STATUSES = ("pending", "processing", "shipped", "out_for_delivery")
OPEN_PAYOUT_STATUSES = ("pending", "approved", "processing")


def get_active_merchant(
    db: Session, user_id: int, *, for_update: bool = False
) -> Merchant | None:
    """The user's merchant profile, or None if they have none or closed it."""
    query = db.query(Merchant).filter(
        Merchant.user_id == user_id, Merchant.deleted_at.is_(None)
    )
    if for_update:
        query = query.with_for_update()
    return query.first()


def find_deletion_blockers(db: Session, merchant_id: int) -> dict[str, int]:
    """Obligations that must be settled before the merchant can be closed.

    Returns only the non-zero counts; an empty dict means deletion is safe.
    """
    active_orders = (
        db.query(func.count(Order.id))
        .filter(
            Order.merchant_id == merchant_id,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .scalar()
    )
    pending_payments = (
        db.query(func.count(Transaction.id))
        .filter(
            Transaction.merchant_id == merchant_id, Transaction.status == "pending"
        )
        .scalar()
    )
    refunds_pending = (
        db.query(func.count(Transaction.id))
        .filter(
            Transaction.merchant_id == merchant_id,
            Transaction.status == "refund_pending",
        )
        .scalar()
    )

    # A paid transaction is settled only once its payout batch is released;
    # unbatched, open or failed batches all still owe the merchant money.
    released_ids = (
        db.query(PayoutBatchItem.transaction_id)
        .join(PayoutBatch, PayoutBatch.id == PayoutBatchItem.batch_id)
        .filter(PayoutBatch.status == "released")
        .scalar_subquery()
    )
    unpaid_earnings = (
        db.query(func.coalesce(func.sum(Transaction.merchant_amount), 0))
        .filter(
            Transaction.merchant_id == merchant_id,
            Transaction.status == "paid",
            Transaction.id.not_in(released_ids),
        )
        .scalar()
    )
    open_payouts = (
        db.query(func.count(PayoutBatch.id))
        .filter(
            PayoutBatch.merchant_id == merchant_id,
            PayoutBatch.status.in_(OPEN_PAYOUT_STATUSES),
        )
        .scalar()
    )

    blockers = {
        "active_orders": active_orders,
        "pending_payments": pending_payments,
        "refunds_pending": refunds_pending,
        "unpaid_earnings": unpaid_earnings,
        "open_payouts": open_payouts,
    }
    return {key: int(value) for key, value in blockers.items() if value}


def soft_delete_merchant(db: Session, merchant: Merchant) -> None:
    """Close the merchant's account, keeping every order and financial record."""
    merchant.deleted_at = datetime.now(UTC)
    # Frees the unique contact number for a new account.
    merchant.contact_number = None
    # Unlinking lets a re-approved application reactivate this merchant
    # (admin approval only acts on applications without a merchant).
    db.query(MerchantApplication).filter(
        MerchantApplication.merchant_id == merchant.id
    ).update({MerchantApplication.merchant_id: None}, synchronize_session=False)


def create_merchant_from_application(
    db: Session,
    application: MerchantApplication,
) -> Merchant:
    db_user = db.query(User).filter(User.id == application.user_id).first()
    if not db_user:
        raise ValueError("User does not exist")

    fields = {
        "merchant_name": application.merchant_name,
        "legal_business_name": application.legal_business_name,
        "business_type": application.business_type,
        "tin": application.tin,
        "registration_type": application.registration_type,
        "registration_number": application.registration_number,
        "contact_email": application.contact_email,
        "contact_number": application.contact_number,
        "region": application.region,
        "province": application.province,
        "city": application.city,
        "barangay": application.barangay,
        "address": application.address,
        "postal_code": application.postal_code,
        "available_days": application.available_days,
        "delivery_time": application.delivery_time,
        "delivery_price": application.delivery_price,
        "price_range_min": application.price_range_min,
        "price_range_max": application.price_range_max,
        "rsbsa_number": application.rsbsa_number,
        "rsbsa_document_path": application.rsbsa_document_path,
        "rsbsa_document_original_name": application.rsbsa_document_original_name,
        "rsbsa_document_content_type": application.rsbsa_document_content_type,
    }

    existing_merchant = (
        db.query(Merchant).filter(Merchant.user_id == application.user_id).first()
    )
    if existing_merchant is not None:
        if existing_merchant.deleted_at is None:
            raise ValueError("User already has a merchant profile")
        # user_id is unique, so a returning merchant reuses their closed row.
        for field, value in fields.items():
            setattr(existing_merchant, field, value)
        existing_merchant.deleted_at = None
        db.flush()
        return existing_merchant

    db_merchant = Merchant(user_id=application.user_id, operating_hours={}, **fields)
    db.add(db_merchant)
    db.flush()
    return db_merchant
