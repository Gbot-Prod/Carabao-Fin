from datetime import datetime

from pydantic import ConfigDict, Field, field_validator

from app.schemas.psgc import AreaCodes
from app.schemas.text import one_line
from app.services.phone_verification import normalize_ph_mobile


class UserAddressBase(AreaCodes):
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

    # Item 6: no control, zero-width or bidi characters; one space between words.
    _one_line = field_validator(
        "label",
        "recipient_name",
        "region",
        "province",
        "city",
        "barangay",
        "address",
        "postal_code",
        mode="before",
    )(one_line)

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
    # True: the pin is outside the chosen city/barangay (services/pin_area.py);
    # None: not checked.
    pin_area_mismatch: bool | None = None
    # Set by the server only: a rider delivered to this pin and did not
    # report it. Moving the pin clears it.
    pin_verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
