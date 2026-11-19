"""Merchant voucher input and output (CF-0061, B05 slice 2).

Field rules match the CHECK constraints on ``vouchers`` (CF-0058). Rules that
need two fields (percent vs fixed value, dates in order) are checked on the
final values in ``services/vouchers.check_rules``, so a PATCH that sends one
field is checked together with the stored ones.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Same as services/vouchers.CODE_PATTERN, before upper-casing.
CODE_FIELD_PATTERN = r"^\s*[A-Za-z0-9][A-Za-z0-9-]{2,31}\s*$"
MAX_PESOS = 1_000_000


class VoucherCreate(BaseModel):
    code: str = Field(pattern=CODE_FIELD_PATTERN)
    kind: Literal["percent", "fixed"]
    value: int = Field(ge=1, le=MAX_PESOS)
    min_subtotal: int = Field(default=0, ge=0, le=MAX_PESOS)
    max_discount: int | None = Field(default=None, ge=1, le=MAX_PESOS)
    usage_limit: int | None = Field(default=None, ge=1, le=100_000)
    per_user_limit: int = Field(default=1, ge=1, le=100)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    active: bool = True

    model_config = ConfigDict(extra="forbid")


class VoucherUpdate(BaseModel):
    """Every field optional; ``code`` cannot change (buyers may have it)."""

    kind: Literal["percent", "fixed"] | None = None
    value: int | None = Field(default=None, ge=1, le=MAX_PESOS)
    min_subtotal: int | None = Field(default=None, ge=0, le=MAX_PESOS)
    max_discount: int | None = Field(default=None, ge=1, le=MAX_PESOS)
    usage_limit: int | None = Field(default=None, ge=1, le=100_000)
    per_user_limit: int | None = Field(default=None, ge=1, le=100)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    active: bool | None = None

    model_config = ConfigDict(extra="forbid")


class VoucherResponse(BaseModel):
    id: int
    code: str
    kind: str
    value: int
    min_subtotal: int
    max_discount: int | None
    usage_limit: int | None
    per_user_limit: int
    starts_at: datetime | None
    expires_at: datetime | None
    active: bool
    created_at: datetime | None
    # Uses on orders that were not cancelled (what the caps count).
    uses: int
