from django.db import models


class Availability(models.Model):
    property = models.ForeignKey("properties.Property", on_delete=models.CASCADE, related_name="availabilities")
    date = models.DateField()
    is_available = models.BooleanField(default=True)
    price_override = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        unique_together = ("property", "date")
