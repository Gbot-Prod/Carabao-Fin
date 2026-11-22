from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, StrictBool

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


class NotificationPreferences(BaseModel):
    """CF-0054 (B49): the channels a buyer can turn off (services/notifications.py).

    ``order_updates`` gates SMS, ``email_alerts`` gates email, ``promotions`` is
    kept for the web toggle. Unknown keys and non-bool values are refused.
    """

    model_config = ConfigDict(extra="forbid")

    # Strict: JSON true/false only ("no", 0 and 1 are refused, not coerced).
    order_updates: StrictBool | None = None
    email_alerts: StrictBool | None = None
    promotions: StrictBool | None = None


class UserUpdate(BaseModel):
    # Name, email and phone belong to BetterAuth and change through its client.
    # Addresses have their own endpoints (/users/me/addresses). Unknown fields
    # are rejected so they can't be smuggled in.
    model_config = ConfigDict(extra="forbid")

    notifications_preferences: NotificationPreferences | None = None


class AccountDeleteCodeRequest(BaseModel):
    # Required when the account has a password (Google/Facebook-only accounts
    # have none).
    password: str | None = Field(default=None, max_length=128)

    model_config = ConfigDict(extra="forbid")  # CF-0085


class AccountDeleteCodeSent(BaseModel):
    sent_to: str  # last 4 digits of the number the code went to


class AccountDeleteConfirm(BaseModel):
    code: str = Field(min_length=4, max_length=10)

    model_config = ConfigDict(extra="forbid")  # CF-0085


class UserMerchantInfo(BaseModel):
    id: int
    merchant_name: str
    # The apps open the merchant screens for any merchant row and show a
    # "not live yet" banner unless this is "verified".
    verification_status: str | None = None

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
    # Admin list only: an invited admin who has not set a password yet.
    admin_invite_pending: bool = False
    is_suspended: bool = False
    suspension_reason: str | None = None
    notifications_preferences: dict | None = None
    merchant: UserMerchantInfo | None = None
    cart: UserCartInfo | None = None
    # Saved delivery addresses, default first.
    addresses: list[UserAddressResponse] = []

    model_config = ConfigDict(from_attributes=True)
