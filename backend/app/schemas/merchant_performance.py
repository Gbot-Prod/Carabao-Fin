from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MerchantPerformanceResponse(BaseModel):
    merchant_id: int
    merchant_name: str
    rating: float | None = None
    rating_count: int = 0

    total_products: int = 0
    total_orders: int = 0
    active_orders: int = 0
    delivered_orders: int = 0
    cancelled_orders: int = 0

    total_revenue: int = 0
    last_order_at: datetime | None = None

    last_30_days_orders: int = 0
    last_30_days_revenue: int = 0

    model_config = ConfigDict(from_attributes=True)
