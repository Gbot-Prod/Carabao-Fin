from pydantic import BaseModel, ConfigDict, Field


class CartItem(BaseModel):
    id: str | None = None
    produce_id: int | None = None
    merchant_id: int | None = None
    name: str | None = None
    produce: str | None = None
    price: float = 0
    quantity: int = 0
    unit: str | None = None
    image: str | None = None
    farm: str | None = None
    merchant: str | None = None

    model_config = ConfigDict(extra="allow")


class CartBase(BaseModel):
    items: list[CartItem] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0


class CartCreate(CartBase):
    user_id: int


class CartUpdate(BaseModel):
    items: list[CartItem] | None = None


class CartResponse(BaseModel):
    id: int
    user_id: int
    items: list[CartItem] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0

    model_config = ConfigDict(from_attributes=True)
