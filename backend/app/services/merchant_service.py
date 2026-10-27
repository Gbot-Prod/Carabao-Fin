from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.user import User


def create_merchant_from_application(
    db: Session,
    application: MerchantApplication,
) -> Merchant:
    db_user = db.query(User).filter(User.id == application.user_id).first()
    if not db_user:
        raise ValueError("User does not exist")

    existing_merchant = (
        db.query(Merchant).filter(Merchant.user_id == application.user_id).first()
    )
    if existing_merchant:
        raise ValueError("User already has a merchant profile")

    db_merchant = Merchant(
        user_id=application.user_id,
        merchant_name=application.merchant_name,
        legal_business_name=application.legal_business_name,
        business_type=application.business_type,
        tin=application.tin,
        registration_type=application.registration_type,
        registration_number=application.registration_number,
        contact_email=application.contact_email,
        contact_number=application.contact_number,
        region=application.region,
        province=application.province,
        city=application.city,
        barangay=application.barangay,
        address=application.address,
        postal_code=application.postal_code,
        available_days=application.available_days,
        operating_hours={},
        delivery_time=application.delivery_time,
        delivery_price=application.delivery_price,
        price_range_min=application.price_range_min,
        price_range_max=application.price_range_max,
        rsbsa_number=application.rsbsa_number,
        rsbsa_document_path=application.rsbsa_document_path,
        rsbsa_document_original_name=application.rsbsa_document_original_name,
        rsbsa_document_content_type=application.rsbsa_document_content_type,
    )
    db.add(db_merchant)
    db.flush()
    return db_merchant
