from pydantic import BaseModel, Field

# A 10-digit PSGC code, as psgc.cloud and the address forms give it.
_CODE = r"^\d{10}$"


class AreaCodes(BaseModel):
    """Optional PSGC codes of the four address levels (services/psgc.py).

    A code wins over the name of the same level; the server stores the PSGC
    name. Without codes, the names are looked up under their parent.
    """

    region_code: str | None = Field(default=None, pattern=_CODE)
    province_code: str | None = Field(default=None, pattern=_CODE)
    city_code: str | None = Field(default=None, pattern=_CODE)
    barangay_code: str | None = Field(default=None, pattern=_CODE)
