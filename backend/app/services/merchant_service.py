from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.user import User
from app.schemas.merchant import MerchantPageBase


def create_merchant(db: Session, user: MerchantPageBase) -> Merchant:
    db_user = db.query(User).filter(User.id == user.user_id).first()
    if not db_user:
        raise ValueError("User does not exist")

    existing_merchant = db.query(Merchant).filter(Merchant.user_id == user.user_id).first()
    if existing_merchant:
        raise ValueError("User already has a merchant profile")

    db_merchant = Merchant(**user.model_dump())
    db.add(db_merchant)
    db.commit()
    db.refresh(db_merchant)
    return db_merchant