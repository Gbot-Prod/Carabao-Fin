from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.phone_verification import normalize_ph_mobile


class UserAddressBase(BaseModel):
    label: str | None = Field(default=None, max_length=50)
    # Who receives deliveries here, and a PH mobile number the rider can call.
    recipient_name: str | None = Field(default=None, max_length=100)
    recipient_phone: str | None = Field(default=None, max_length=20)
    region: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    barangay: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=10)
    # Map pin for the address (U1).
    lat: float | None = None
    lng: float | None = None
    # The person placed or moved the pin themselves (not only geocoded).
    pin_confirmed: bool = False

    @field_validator("recipient_name")
    @classmethod
    def _clean_name(cls, value: str | None) -> str | None:
        return " ".join(value.split()) or None if value is not None else None

    @field_validator("recipient_phone")
    @classmethod
    def _ph_mobile(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        digits = normalize_ph_mobile(value)
        if digits is None:
            raise ValueError("Enter a PH mobile number, e.g. 0917 123 4567")
        return f"+{digits}"


class UserAddressCreate(UserAddressBase):
    model_config = ConfigDict(extra="forbid")

    # The first address is always made the default.
    is_default: bool = False


class UserAddressUpdate(UserAddressBase):
    model_config = ConfigDict(extra="forbid")

    # Only true does anything: it makes this the default. To change the
    # default, set it on the other address.
    is_default: bool | None = None


class UserAddressResponse(UserAddressBase):
    id: int
    is_default: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
