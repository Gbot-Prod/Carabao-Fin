"""A small PSGC set for tests (the real list is app/data/psgc.csv).

The shared ``db`` fixture loads it, so address routes can resolve these places.
Codes are the real PSGC codes; the barangay lists are cut short.
"""

from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.models.psgc_area import PsgcArea
from app.services.psgc import name_key

R3, NCR, CAR, R4A, R7, R11, MIMAROPA = (
    "0300000000",
    "1300000000",
    "1400000000",
    "0400000000",
    "0700000000",
    "1100000000",
    "1700000000",
)

# (code, level, name, parent_code, region_code, city_type, postal_code)
ROWS: tuple[tuple[str, str, str, str | None, str, str | None, str | None], ...] = (
    (R3, "region", "Region III (Central Luzon)", None, R3, None, None),
    (NCR, "region", "National Capital Region (NCR)", None, NCR, None, None),
    (CAR, "region", "Cordillera Administrative Region (CAR)", None, CAR, None, None),
    (R4A, "region", "Region IV-A (CALABARZON)", None, R4A, None, None),
    (R7, "region", "Region VII (Central Visayas)", None, R7, None, None),
    (R11, "region", "Region XI (Davao Region)", None, R11, None, None),
    (MIMAROPA, "region", "MIMAROPA Region", None, MIMAROPA, None, None),
    # Region III / Bulacan
    ("0301400000", "province", "Bulacan", R3, R3, None, None),
    ("0301410000", "city", "City of Malolos", "0301400000", R3, "City", "3000"),
    ("0301410001", "barangay", "Poblacion", "0301410000", R3, None, None),
    ("0301410002", "barangay", "San Isidro", "0301410000", R3, None, None),
    ("0301409000", "city", "Hagonoy", "0301400000", R3, "Mun", "3002"),
    ("0301409001", "barangay", "San Isidro", "0301409000", R3, None, None),
    ("0301409002", "barangay", "Santo Niño", "0301409000", R3, None, None),
    # NCR: cities hang off the region; City of Manila has no barangays.
    ("1381300000", "city", "Quezon City", NCR, NCR, "City", None),
    ("1381300001", "barangay", "Alicia", "1381300000", NCR, None, None),
    ("1380600000", "city", "City of Manila", NCR, NCR, "City", None),
    ("1380608000", "city", "Ermita", NCR, NCR, "SubMun", None),
    ("1380608001", "barangay", "Barangay 659", "1380608000", NCR, None, None),
    ("1380100000", "city", "City of Las Piñas", NCR, NCR, "City", None),
    ("1380100001", "barangay", "Almanza Uno", "1380100000", NCR, None, None),
    # CAR / Benguet: City of Baguio is under Benguet in the form.
    ("1401100000", "province", "Benguet", CAR, CAR, None, None),
    ("1430300000", "city", "City of Baguio", "1401100000", CAR, "City", "2600"),
    ("1430300001", "barangay", "Session Road Area", "1430300000", CAR, None, None),
    # Region IV-A / Laguna
    ("0403400000", "province", "Laguna", R4A, R4A, None, None),
    ("0403405000", "city", "City of Calamba", "0403400000", R4A, "City", None),
    ("0403405001", "barangay", "Real", "0403405000", R4A, None, None),
    # Outside Luzon
    ("0702200000", "province", "Cebu", R7, R7, None, None),
    ("0730600000", "city", "Cebu City", "0702200000", R7, "City", "6000"),
    ("0730600001", "barangay", "Lahug", "0730600000", R7, None, None),
    ("1102400000", "province", "Davao del Sur", R11, R11, None, None),
    ("1102404000", "city", "Hagonoy", "1102400000", R11, "Mun", None),
    ("1102404001", "barangay", "San Isidro", "1102404000", R11, None, None),
    ("1705200000", "province", "Oriental Mindoro", MIMAROPA, MIMAROPA, None, None),
    ("1705205000", "city", "City of Calapan", "1705200000", MIMAROPA, "City", None),
    ("1705205001", "barangay", "Lalud", "1705205000", MIMAROPA, None, None),
)

# The address the tests use most: a full Luzon chain.
MALOLOS = {
    "region": "Region III (Central Luzon)",
    "province": "Bulacan",
    "city": "City of Malolos",
    "barangay": "Poblacion",
}


def seed_psgc(db: Session) -> None:
    db.execute(
        insert(PsgcArea),
        [
            {
                "code": code,
                "level": level,
                "name": name,
                "name_key": name_key(name),
                "parent_code": parent,
                "region_code": region,
                "city_type": city_type,
                "postal_code": postal,
            }
            for code, level, name, parent, region, city_type, postal in ROWS
        ],
    )
    db.commit()
