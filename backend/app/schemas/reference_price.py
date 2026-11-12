from datetime import date

from pydantic import BaseModel


class ReferencePriceResponse(BaseModel):
    id: int
    commodity: str
    aliases: list[str]
    unit: str
    low: int
    high: int
    source: str
    as_of: date
    # True for placeholder rows; clients must label these as samples.
    is_sample: bool
