from typing import Optional
from pydantic import BaseModel, ConfigDict


class ProduceBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    price: int = 0
    unit: str = "kg"
    stock_quantity: int = 0
    image_url: Optional[str] = None


class ProduceCreate(ProduceBase):
    pass


class ProduceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    price: Optional[int] = None
    unit: Optional[str] = None
    stock_quantity: Optional[int] = None
    image_url: Optional[str] = None


class ProduceResponse(ProduceBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)
