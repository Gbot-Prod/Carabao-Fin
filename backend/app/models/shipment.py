from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Shipment(Base):
	__tablename__ = "shipments"

	id = Column(Integer, primary_key=True, index=True)
	merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, index=True)
	status = Column(String, nullable=False, default="in_transit", index=True)
	stop_count = Column(Integer, nullable=False, default=0)
	route_waypoints = Column(JSON, nullable=False, default=list)
	shipped_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
	created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

	merchant = relationship("Merchant", backref="shipments")
	orders = relationship("Order", back_populates="shipment")