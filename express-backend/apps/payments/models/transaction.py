from django.db import models


class Transaction(models.Model):
    class Method(models.TextChoices):
        CARD = "card", "Card"
        MOMO = "momo", "Mobile Money"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    booking = models.ForeignKey("bookings.Booking", on_delete=models.CASCADE, related_name="transactions")
    method = models.CharField(max_length=10, choices=Method.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default="USD")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    provider_ref = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
