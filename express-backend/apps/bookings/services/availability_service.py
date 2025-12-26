from datetime import date, timedelta
from django.db.models import Q
from apps.bookings.models.availability import Availability


def is_range_available(property_id: int, start: date, end: date) -> bool:
    days = (end - start).days
    if days <= 0:
        return False
    dates = [start + timedelta(days=i) for i in range(days)]
    conflicts = Availability.objects.filter(property_id=property_id, date__in=dates, is_available=False).exists()
    return not conflicts
