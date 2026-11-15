"""Money arithmetic (CF-0014).

Amounts are whole pesos in the database. Calculations use ``Decimal`` and round
half up (0.5 goes up, as people expect, not to the nearest even number like
``round()``). PayMongo takes integer centavos, converted only at that boundary.

A value that is not a valid amount (missing, not a number, NaN, infinite,
negative, a bool) raises ``InvalidAmount``. It never becomes 0.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENTAVOS_PER_PESO = 100
PLATFORM_FEE_RATE = Decimal("0.02")
# Far above any real amount (also in centavos); stops "1e999999" style input.
MAX_AMOUNT = Decimal(10) ** 15
_ONE = Decimal(1)


class InvalidAmount(ValueError):
    """A price or amount that cannot be used for money arithmetic."""


def to_decimal(value: object) -> Decimal:
    """``value`` as a finite, non-negative Decimal, else InvalidAmount."""
    if isinstance(value, bool) or value is None:
        raise InvalidAmount(f"Invalid amount: {value!r}")
    if isinstance(value, Decimal):
        amount = value
    elif isinstance(value, int):
        amount = Decimal(value)
    elif isinstance(value, float | str):
        # str() first, so 0.1 is Decimal("0.1"), not its binary expansion.
        try:
            amount = Decimal(str(value).strip())
        except InvalidOperation as exc:
            raise InvalidAmount(f"Invalid amount: {value!r}") from exc
    else:
        raise InvalidAmount(f"Invalid amount: {value!r}")
    if not amount.is_finite() or amount < 0 or amount > MAX_AMOUNT:
        raise InvalidAmount(f"Invalid amount: {value!r}")
    return amount


def round_pesos(value: object) -> int:
    """Whole pesos, rounded half up."""
    return int(to_decimal(value).quantize(_ONE, rounding=ROUND_HALF_UP))


def whole_pesos(value: object) -> int:
    """A stored peso amount. Fractions are invalid here, not rounded."""
    amount = to_decimal(value)
    if amount != amount.to_integral_value():
        raise InvalidAmount(f"Not a whole peso amount: {value!r}")
    return int(amount)


def platform_fee(amount_pesos: object) -> int:
    """The platform's share of a payment, in whole pesos."""
    return round_pesos(to_decimal(amount_pesos) * PLATFORM_FEE_RATE)


def to_centavos(amount_pesos: object) -> int:
    """Integer centavos for PayMongo. The amount must be above zero."""
    centavos = (to_decimal(amount_pesos) * CENTAVOS_PER_PESO).quantize(
        _ONE, rounding=ROUND_HALF_UP
    )
    if centavos <= 0:
        raise InvalidAmount(f"Amount must be above zero: {amount_pesos!r}")
    return int(centavos)


def from_centavos(centavos: object) -> Decimal:
    """Pesos from PayMongo's integer centavos."""
    amount = to_decimal(centavos)
    if amount != amount.to_integral_value():
        raise InvalidAmount(f"Centavos must be whole: {centavos!r}")
    return amount / CENTAVOS_PER_PESO


def line_total(unit_price: object, quantity: object) -> int:
    """Unit price times quantity, both whole numbers."""
    return whole_pesos(unit_price) * whole_pesos(quantity)
