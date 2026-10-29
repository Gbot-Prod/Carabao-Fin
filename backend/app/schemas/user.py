from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserBase(BaseModel):
    external_auth_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr
    phone_number: str | None = None
    region: str | None = None
    province: str | None = None
    city: str | None = None
    barangay: str | None = None
    address: str | None = None
    postal_code: str | None = None
    created_at: datetime | None = None
    profile_picture_url: str | None = None
    notifications_preferences: dict | None = None


class UserCreate(UserBase):
    pass


class UserUpdate(BaseModel):
    # Identity fields (email, external_auth_id) are owned by Better Auth and
    # only change through /auth/sync. Unknown fields are rejected so they
    # can't be smuggled in.
    model_config = ConfigDict(extra="forbid")

    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None
    region: str | None = None
    province: str | None = None
    city: str | None = None
    barangay: str | None = None
    address: str | None = None
    postal_code: str | None = None
    notifications_preferences: dict | None = None


class UserMerchantInfo(BaseModel):
    id: int
    merchant_name: str

    model_config = ConfigDict(from_attributes=True)


class UserCartInfo(BaseModel):
    id: int
    total_items: int
    total_price: int

    model_config = ConfigDict(from_attributes=True)


class UserResponse(UserBase):
    id: int
    is_admin: bool = False
    notifications_preferences: dict | None = None
    merchant: UserMerchantInfo | None = None
    cart: UserCartInfo | None = None

    model_config = ConfigDict(from_attributes=True)
