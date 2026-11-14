from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserAddressBase(BaseModel):
    label: str | None = Field(default=None, max_length=50)
    region: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    barangay: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=10)
    # Map pin for the address (U1).
    lat: float | None = None
    lng: float | None = None


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
