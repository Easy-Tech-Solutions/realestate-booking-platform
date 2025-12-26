from django.db import models

class Booking(models.Model):
    listing_title = models.CharField(max_length=200)
    customer_name = models.CharField(max_length=200)
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.customer_name} - {self.listing_title}"
