from django.db import models
from django.db.models import Q
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from listings.models import Listing
import uuid

# Reservation lifecycle windows (see the revised booking flow).
HOST_CONFIRM_DAYS = 7    # host must confirm a reservation within this window
PAYMENT_WINDOW_DAYS = 10  # guest must pay within this window after host confirms


class Booking(models.Model):
    STATUS_CHOICES = [
        # ---- Current flow ----
        ('pending_host', 'Pending Host Confirmation'),   # Reserved free; awaiting host. Listing stays public.
        ('awaiting_payment', 'Awaiting Payment'),        # Host confirmed; listing pulled; 10-day pay clock running.
        ('payment_received', 'Payment Received'),         # Guest paid; awaiting admin confirmation.
        ('confirmed', 'Confirmed'),                       # Admin confirmed payment; contact shared; payout created.
        ('declined', 'Declined'),                         # Host declined, or auto-declined as a losing concurrent reservation.
        ('expired_unconfirmed', 'Expired (Host Did Not Confirm)'),  # Host missed the 7-day window.
        ('expired_unpaid', 'Expired (Payment Not Completed)'),      # Guest missed the 10-day window; listing relisted.
        ('cancelled', 'Cancelled'),
        ('completed', 'Completed'),
        # ---- Legacy statuses (kept so historical rows still resolve) ----
        ('requested', 'Requested (legacy)'),
        ('payment_requested', 'Payment Requested (legacy)'),
        ('pending', 'Pending (legacy)'),
    ]

    # Statuses where a booking is "alive" — still holding a claim on the
    # listing/dates. Used by the uniqueness constraint and availability checks.
    ACTIVE_STATUSES = [
        'pending_host', 'awaiting_payment', 'payment_received', 'confirmed',
        'requested', 'payment_requested', 'pending',  # legacy
    ]

    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE, related_name='bookings')
    hotel_room = models.ForeignKey(
        'listings.HotelRoom', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='bookings'
    )
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='bookings')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending_host')
    notes = models.TextField(blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    owner_notes = models.TextField(blank=True)
    decline_reason = models.TextField(blank=True)
    total_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # Guest-side service fee portion of total_price, stored for receipt/audit.
    service_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=100, blank=True, null=True, unique=True)

    # Path C marker: this reservation came through a property viewing.
    requires_viewing = models.BooleanField(default=False)

    # Reservation timers (see the revised booking flow).
    # Deadline for the host to confirm; set at reservation time.
    host_confirm_deadline = models.DateTimeField(null=True, blank=True)
    # When the host confirmed — starts the payment clock and pulls the listing.
    host_confirmed_at = models.DateTimeField(null=True, blank=True)
    # Deadline for the guest to complete payment; set at host confirmation.
    payment_due_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        # Only enforce uniqueness while the booking is "alive". A declined,
        # cancelled, expired, or completed booking should not block the same
        # guest from re-booking the same property/dates.
        constraints = [
            models.UniqueConstraint(
                fields=['customer', 'listing', 'start_date', 'end_date'],
                condition=Q(status__in=[
                    'pending_host', 'awaiting_payment', 'payment_received', 'confirmed',
                    'requested', 'payment_requested', 'pending',  # legacy
                ]),
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

    # ---- Lifecycle helpers -------------------------------------------------

    def mark_host_confirmed(self):
        """
        Host accepts the reservation: pull the listing from public view and
        start the 10-day payment clock. Caller is responsible for declining
        other concurrent reservations and saving the listing.
        """
        now = timezone.now()
        self.status = 'awaiting_payment'
        self.host_confirmed_at = now
        self.payment_due_at = now + timedelta(days=PAYMENT_WINDOW_DAYS)
        self.save(update_fields=['status', 'host_confirmed_at', 'payment_due_at'])

    @property
    def is_host_confirm_overdue(self):
        return (
            self.status == 'pending_host'
            and self.host_confirm_deadline is not None
            and timezone.now() >= self.host_confirm_deadline
        )

    @property
    def is_payment_overdue(self):
        return (
            self.status == 'awaiting_payment'
            and self.payment_due_at is not None
            and timezone.now() >= self.payment_due_at
        )


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


class ViewingAppointment(models.Model):
    """
    A long-term-rental property viewing (Path C of the booking flow).

    The guest requests a Saturday slot, pays the non-refundable viewing fee,
    an admin schedules + confirms, and a Home Konet rep visits the property
    with the guest. If satisfied, the guest clicks "Reserve Property", which
    creates a Booking (status awaiting_payment) and pulls the listing.
    """
    STATUS_CHOICES = [
        ('requested', 'Requested'),       # Slot chosen; awaiting viewing-fee payment.
        ('fee_paid', 'Fee Paid'),         # Fee paid; awaiting admin scheduling.
        ('scheduled', 'Scheduled'),       # Admin confirmed date/time with the guest.
        ('completed', 'Completed'),        # Visit happened.
        ('reserved', 'Reserved'),          # Guest clicked "Reserve Property" → Booking created.
        ('cancelled', 'Cancelled'),
        ('expired', 'Expired'),
    ]

    # Statuses that still occupy a property's Saturday slot.
    ACTIVE_STATUSES = ['requested', 'fee_paid', 'scheduled', 'completed', 'reserved']

    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE, related_name='viewings')
    guest = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='viewings')
    viewing_date = models.DateField(help_text='Must be a Saturday.')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')

    # Viewing fee (flat, non-refundable). Snapshot of the fee at request time.
    viewing_fee = models.DecimalField(max_digits=8, decimal_places=2)
    is_fee_paid = models.BooleanField(default=False)
    fee_paid_at = models.DateTimeField(null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=100, blank=True, null=True, unique=True)

    # Admin scheduling.
    scheduled_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='viewings_confirmed',
    )
    admin_notes = models.TextField(blank=True)
    guest_notes = models.TextField(blank=True)

    # Set when the guest clicks "Reserve Property" after the visit.
    booking = models.OneToOneField(
        Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='viewing',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            # One viewing slot per property per Saturday: a property can only be
            # held by a single active viewing on a given date.
            models.UniqueConstraint(
                fields=['listing', 'viewing_date'],
                condition=Q(status__in=['requested', 'fee_paid', 'scheduled', 'completed', 'reserved']),
                name='unique_active_viewing_per_listing_date',
            ),
        ]

    def __str__(self):
        return f'Viewing: {self.guest.username} @ {self.listing.title} on {self.viewing_date} ({self.status})'


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
