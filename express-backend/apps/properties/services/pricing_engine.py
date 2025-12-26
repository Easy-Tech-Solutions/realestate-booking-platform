from decimal import Decimal


def calculate_price(base_price: Decimal, season_multiplier: float = 1.0, weekend: bool = False) -> Decimal:
    price = Decimal(base_price) * Decimal(str(season_multiplier))
    if weekend:
        price *= Decimal("1.10")
    return price.quantize(Decimal("0.01"))
