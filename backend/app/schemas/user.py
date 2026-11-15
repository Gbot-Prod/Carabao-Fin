from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user_address import UserAddressResponse


class UserBase(BaseModel):
    external_auth_id: str | None = None
    # Identity, read live from BetterAuth. email is None for a phone signup
    # that hasn't added one.
    name: str | None = None
    email: str | None = None
    email_verified: bool = False
    phone_number: str | None = None
    phone_verified: bool = False
    created_at: datetime | None = None
    profile_picture_url: str | None = None
    notifications_preferences: dict | None = None


class UserUpdate(BaseModel):
    # Name, email and phone belong to BetterAuth and change through its client.
    # Addresses have their own endpoints (/users/me/addresses). Unknown fields
    # are rejected so they can't be smuggled in.
    model_config = ConfigDict(extra="forbid")

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
    two_factor_enabled: bool = False
    is_suspended: bool = False
    suspension_reason: str | None = None
    notifications_preferences: dict | None = None
    merchant: UserMerchantInfo | None = None
    cart: UserCartInfo | None = None
    # Saved delivery addresses, default first.
    addresses: list[UserAddressResponse] = []

    model_config = ConfigDict(from_attributes=True)
