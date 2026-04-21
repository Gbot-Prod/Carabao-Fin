from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class ShopPage(Base):
    __tablename__ = "shop_pages"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, unique=True, index=True)
    title = Column(String, nullable=False, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    banner_image_url = Column(String, nullable=True)
    description = Column(Text, nullable=True)

    merchant = relationship("Merchant", back_populates="shop_page")
