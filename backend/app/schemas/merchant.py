from pydantic import BaseModel

class MerchantPageBase(BaseModel):
    merchant_name: str
    location: str
    contact_number: str
    operating_hours: str
    delivery_price: int
    delivery_time: int
    rating: float


class MerchantResponse(MerchantPageBase):
    id: int
    class Config:
        from_attributes = True

