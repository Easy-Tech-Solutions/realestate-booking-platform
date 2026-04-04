from django.db import models
<<<<<<< HEAD
from django.conf import settings

class Booking(models.Model):
    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('confirmed', 'Confirmed'),
        ('declined', 'Declined'),
        ('cancelled', 'Cancelled'),
        ('completed', 'Completed'),
    ]

    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE, related_name='bookings')
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='bookings')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')
    notes = models.TextField(blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    owner_notes = models.TextField(blank=True)
    decline_reason = models.TextField(blank=True)

    class Meta:
        unique_together = ['customer', 'listing', 'start_date', 'end_date']  #Prevent double bookings
        ordering = ['-requested_at']
    def __str__(self):
        return f"{self.customer.username} - {self.listing.title} ({self.status})"
=======

class Booking(models.Model):
    listing_title = models.CharField(max_length=200)
    customer_name = models.CharField(max_length=200)
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.customer_name} - {self.listing_title}"
>>>>>>> dalton
