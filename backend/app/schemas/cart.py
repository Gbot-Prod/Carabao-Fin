from pydantic import BaseModel, ConfigDict, Field, field_validator

# A cart holds at most this many lines, each at most this many sale units.
MAX_CART_ITEMS = 50
MAX_ITEM_QUANTITY = 10_000


class CartItemIn(BaseModel):
    """One cart line as the client sends it. Everything else comes from the
    produce row on the server (CF-0008)."""

    produce_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=MAX_ITEM_QUANTITY)

    model_config = ConfigDict(extra="forbid")


class CartUpdate(BaseModel):
    items: list[CartItemIn] = Field(max_length=MAX_CART_ITEMS)

    model_config = ConfigDict(extra="forbid")

    @field_validator("items")
    @classmethod
    def no_duplicate_produce(cls, items: list[CartItemIn]) -> list[CartItemIn]:
        ids = [item.produce_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each produce may appear only once in the cart")
        return items


class CartItem(BaseModel):
    """One stored cart line, written by the server from the produce row."""

    # str(produce_id); clients key their cart rows on it.
    id: str
    produce_id: int
    merchant_id: int | None = None
    produce: str
    unit: str
    image: str | None = None
    farm: str | None = None
    price: int
    quantity: int
    min_order_qty: int = 1
    stock_quantity: int = 0
    # The merchant's delivery fee for its order (C1).
    delivery_fee: int = 0
    # Why checkout would refuse this line now, e.g. "is no longer available"
    # (CF-0052). None when the line can be bought.
    unavailable_reason: str | None = None


class CartResponse(BaseModel):
    id: int
    user_id: int
    items: list[CartItem] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0

    model_config = ConfigDict(from_attributes=True)
