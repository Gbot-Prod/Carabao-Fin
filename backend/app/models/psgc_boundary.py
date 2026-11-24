from sqlalchemy import CheckConstraint, Column, Float, Index, LargeBinary, String

from app.core.database import Base


class PsgcBoundary(Base):
    """The boundary polygon of one Luzon city/municipality or barangay.

    Reference data, loaded from app/data/psgc_boundaries.jsonl.gz
    (scripts/load_psgc_boundaries.py). ``code`` is the PSGC code, the same as
    psgc_areas.code. services/pin_area.py reads it to compare a pin with the
    city and barangay of its address; nothing writes it at run time.

    No PostGIS: the polygon is WKB (EPSG:4326, lng/lat) and the test runs in
    Python (shapely). The bounding box finds the city a pin is in without
    reading every polygon.
    """

    __tablename__ = "psgc_boundaries"

    code = Column(String(10), primary_key=True)
    level = Column(String(10), nullable=False)
    min_lat = Column(Float, nullable=False)
    min_lng = Column(Float, nullable=False)
    max_lat = Column(Float, nullable=False)
    max_lng = Column(Float, nullable=False)
    geometry = Column(LargeBinary, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "level IN ('city', 'barangay')", name="ck_psgc_boundaries_level"
        ),
        Index("ix_psgc_boundaries_level_lat", "level", "min_lat", "max_lat"),
    )
