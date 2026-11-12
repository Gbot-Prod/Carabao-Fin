from sqlalchemy import Column, Date, Integer, String, UniqueConstraint

from app.core.database import Base


class ReferencePrice(Base):
    """A market reference price range for one commodity (P1).

    Loaded from app/data/reference_prices.csv by scripts/load_reference_prices.py.
    Rows whose source starts with "SAMPLE" are placeholders, not real prices.
    """

    __tablename__ = "reference_prices"
    __table_args__ = (
        UniqueConstraint(
            "commodity", "unit", name="uq_reference_prices_commodity_unit"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    commodity = Column(String, nullable=False, index=True)
    # Other names buyers and farmers use, separated by ";" (e.g. "eggplant").
    aliases = Column(String, nullable=False, default="")
    unit = Column(String, nullable=False, default="kg")
    low = Column(Integer, nullable=False)  # pesos per unit
    high = Column(Integer, nullable=False)  # pesos per unit
    source = Column(String, nullable=False)
    as_of = Column(Date, nullable=False)
