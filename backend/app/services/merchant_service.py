from sqlalchemy.orm import Session
from app.models.merchant import Merchant
from app.schemas.merchant import MerchantPageBase


def create_merchant(db: Session, user: MerchantPageBase) -> Merchant:
  db_merchant = Merchant(**user.model_dump())
  db.add(db_merchant)
  db.commit()
  db.refresh(db_merchant)
  return db_merchant