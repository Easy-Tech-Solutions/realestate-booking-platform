from django.db import models
from django.db.models import Q
from django.conf import settings
from listings.models import Listing
import uuid


class Booking(models.Model):
    STATUS_CHOICES = [
        ('requested', 'Requested'),           # Booking fee paid; awaiting owner review
        ('payment_requested', 'Payment Requested'),  # Owner sent payment request to guest
        ('payment_received', 'Payment Received'),    # Guest paid; awaiting admin confirmation
        ('confirmed', 'Confirmed'),           # Admin confirmed
        ('declined', 'Declined'),
        ('cancelled', 'Cancelled'),
        ('completed', 'Completed'),
    ]

    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE, related_name='bookings')
    hotel_room = models.ForeignKey(
        'listings.HotelRoom', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='bookings'
    )
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
    total_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=100, blank=True, null=True, unique=True)

    class Meta:
        # Only enforce uniqueness while the booking is "alive". A declined,
        # cancelled, or completed booking should not block the same guest from
        # re-booking the same property/dates.
        constraints = [
            models.UniqueConstraint(
                fields=['customer', 'listing', 'start_date', 'end_date'],
                condition=Q(status__in=['requested', 'pending', 'confirmed']),
                name='unique_active_booking_per_guest_listing_dates',
            ),
        ]
        ordering = ['-requested_at']

    def __str__(self):
        return f"{self.customer.username} - {self.listing.title} ({self.status})"

    @property
    def total_amount(self):
        days = (self.end_date - self.start_date).days
        return self.listing.price * max(days, 1)


class PaymentRequest(models.Model):
    """
    Created by the property owner once they've agreed terms with the guest.
    The guest sees a 'Make payment' prompt and is redirected to pay the
    property amount.  Admin must then confirm to move the booking to 'confirmed'.
    """
    booking = models.OneToOneField(
        Booking, on_delete=models.CASCADE, related_name='payment_request',
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default='USD')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='payment_requests_sent',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    is_paid = models.BooleanField(default=False)
    paid_at = models.DateTimeField(null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'PaymentRequest for Booking #{self.booking_id} — ${self.amount}'


class SavedSearch(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_searches')
    name = models.CharField(max_length=100)

    min_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    max_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    property_type = models.CharField(max_length=50, null=True, blank=True)
    min_bedrooms = models.IntegerField(null=True, blank=True)
    max_bedrooms = models.IntegerField(null=True, blank=True)
    min_square_footage = models.IntegerField(null=True, blank=True)
    max_square_footage = models.IntegerField(null=True, blank=True)
    address = models.CharField(max_length=200, blank=True)
    keywords = models.CharField(max_length=200, blank=True)
    is_available = models.BooleanField(default=True)

    email_frequency = models.CharField(max_length=20, choices=[
        ('instantly', 'Instantly'),
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
    ], default='daily')
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} - {self.name}'


class SearchAlert(models.Model):
    saved_search = models.ForeignKey(SavedSearch, on_delete=models.CASCADE, related_name='alerts')
    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE, related_name='alerts')
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['saved_search', 'listing']
        ordering = ['-sent_at']

    def __str__(self):
        return f'Alert: {self.saved_search.name} - {self.listing.title}'


class PropertyComparison(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='comparisons')
    name = models.CharField(max_length=100)
    is_public = models.BooleanField(default=False)
    share_token = models.CharField(max_length=32, blank=True, null=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.user.username} - {self.name}'

    def save(self, *args, **kwargs):
        if self.is_public and not self.share_token:
            self.share_token = uuid.uuid4().hex
        super().save(*args, **kwargs)


class ComparisonItem(models.Model):
    comparison = models.ForeignKey(PropertyComparison, on_delete=models.CASCADE, related_name='items')
    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ['comparison', 'listing']
        ordering = ['order']

    def __str__(self):
        return f'{self.comparison.name} - {self.listing.title}'
