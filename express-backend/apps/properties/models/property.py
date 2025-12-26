from django.conf import settings
from django.db import models


class Property(models.Model):
    class PropertyType(models.TextChoices):
        ROOM = "room", "Room"
        APARTMENT = "apartment", "Apartment"
        HOUSE = "house", "House"
        HOTEL = "hotel", "Hotel"
        LAND = "land", "Land"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="properties")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=20, choices=PropertyType.choices)
    category = models.ForeignKey("properties.Category", on_delete=models.SET_NULL, null=True, blank=True)
    amenities = models.ManyToManyField("properties.Amenity", blank=True)
    location = models.ForeignKey("properties.Location", on_delete=models.SET_NULL, null=True, blank=True)
    media = models.ManyToManyField("properties.PropertyMedia", blank=True)

    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="USD")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:  # pragma: no cover
        return self.title
