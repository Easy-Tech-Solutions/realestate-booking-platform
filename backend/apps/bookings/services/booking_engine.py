from decimal import Decimal
from datetime import date
from apps.bookings.services.availability_service import is_range_available


def quote(property_id: int, start: date, end: date, base_price: Decimal, guests: int = 1) -> Decimal:
    if not is_range_available(property_id, start, end):
        raise ValueError("Property not available for the selected dates")
    days = (end - start).days
    if days <= 0:
        raise ValueError("Invalid date range")
    total = Decimal(base_price) * days
    if guests > 2:
        total *= Decimal("1.05")
    return total.quantize(Decimal("0.01"))
