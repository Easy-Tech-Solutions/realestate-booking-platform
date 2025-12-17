from datetime import timedelta, date
from decimal import Decimal


def refundable_amount(total: Decimal, created_at: date, cancel_at: date) -> Decimal:
    delta = cancel_at - created_at
    if delta >= timedelta(days=7):
        pct = Decimal("0.90")
    elif delta >= timedelta(days=2):
        pct = Decimal("0.50")
    else:
        pct = Decimal("0.00")
    return (Decimal(total) * pct).quantize(Decimal("0.01"))
