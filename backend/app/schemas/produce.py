from typing import Optional
from pydantic import BaseModel, ConfigDict


class ProduceBase(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contact_number: Optional[str] = None
    operating_hours: Optional[str] = None
    delivery_time: Optional[int] = None
    delivery_price: Optional[int] = None
    rating: Optional[int] = None


class ProduceCreate(ProduceBase):
    pass


class ProduceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contact_number: Optional[str] = None
    operating_hours: Optional[str] = None
    delivery_time: Optional[int] = None
    delivery_price: Optional[int] = None
    rating: Optional[int] = None


class ProduceResponse(ProduceBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)
