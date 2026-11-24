from sqlalchemy import CheckConstraint, Column, Index, String

from app.core.database import Base

PSGC_LEVELS = ("region", "province", "city", "barangay")


class PsgcArea(Base):
    """One PSGC place: a region, province, city/municipality or barangay.

    Reference data, loaded from app/data/psgc.csv (scripts/load_psgc.py). The
    address checks (services/psgc.py) read it; nothing writes it at run time.
    ``parent_code`` is the parent the address form shows: a province for most
    cities, the region for NCR's cities, the city for a barangay.
    """

    __tablename__ = "psgc_areas"

    code = Column(String(10), primary_key=True)
    level = Column(String(10), nullable=False)
    name = Column(String(150), nullable=False)
    # services.psgc.name_key(name): the form names are compared in.
    name_key = Column(String(150), nullable=False)
    parent_code = Column(String(10), nullable=True)
    region_code = Column(String(10), nullable=False)
    # City, Mun, SubMun (Manila's districts) or SGU; cities only.
    city_type = Column(String(10), nullable=True)
    # 4-digit postal code from the PSGC source, cities only. Used to fill a blank
    # postal code, never to refuse one (the source has gaps and errors).
    postal_code = Column(String(4), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "level IN ('region', 'province', 'city', 'barangay')",
            name="ck_psgc_areas_level",
        ),
        Index("ix_psgc_areas_parent_name", "parent_code", "name_key"),
        Index("ix_psgc_areas_level_name", "level", "name_key"),
    )
