from typing import Optional

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    external_auth_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: EmailStr
    phone_number: Optional[str] = None
    created_at: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    external_auth_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    created_at: Optional[str] = None


class UserMerchantInfo(BaseModel):
    id: int
    merchant_name: str

    class Config:
        from_attributes = True


class UserCartInfo(BaseModel):
    id: int
    total_items: int
    total_price: int

    class Config:
        from_attributes = True


class UserResponse(UserBase):
    id: int
    merchant: Optional[UserMerchantInfo] = None
    cart: Optional[UserCartInfo] = None

    class Config:
        from_attributes = True