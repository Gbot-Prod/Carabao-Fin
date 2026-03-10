from pydantic import BaseModel

class MerchantBase(BaseModel):
    merchant_name: str
    email: str
    password_hash: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True