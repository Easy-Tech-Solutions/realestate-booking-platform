from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.conf import settings
from django.utils.text import slugify


class PropertyCategory(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Listing(models.Model):
    PRIVACY_TYPES = [
        ('entire_place', 'Entire place'),
        ('private_room', 'Private room'),
        ('shared_room', 'Shared room'),
    ]

    BOOKING_MODES = [
        ('instant', 'Instant book'),
        ('approve_first', 'Approve first'),
    ]

    CANCELLATION_POLICIES = [
        ('flexible', 'Flexible'),
        ('moderate', 'Moderate'),
        ('strict', 'Strict'),
        ('super_strict', 'Super Strict'),
    ]

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('pending_review', 'Pending Review'),
        ('published', 'Published'),
        ('rejected', 'Rejected'),
        ('suspended', 'Suspended by admin'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    bedrooms = models.IntegerField(default=0)
    beds = models.IntegerField(default=0)
    bathrooms = models.IntegerField(default=0)
    max_guests = models.IntegerField(default=1)
    property_type = models.CharField(max_length=50, default='apartment')
    privacy_type = models.CharField(max_length=20, choices=PRIVACY_TYPES, default='entire_place')
    booking_mode = models.CharField(max_length=20, choices=BOOKING_MODES, default='instant')
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='listings')
    address = models.CharField(max_length=200, blank=False)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    check_in_time = models.CharField(max_length=10, default='15:00')
    check_out_time = models.CharField(max_length=10, default='11:00')
    self_checkin = models.BooleanField(default=False)
    square_footage = models.IntegerField(default=0)
    amenities = models.JSONField(default=list, blank=True)
    highlights = models.JSONField(default=list, blank=True)
    weekend_premium_percent = models.IntegerField(default=0)
    new_listing_promo = models.BooleanField(default=False)
    last_minute_discount_enabled = models.BooleanField(default=False)
    last_minute_discount_percent = models.IntegerField(default=0)
    weekly_discount_enabled = models.BooleanField(default=False)
    weekly_discount_percent = models.IntegerField(default=0)
    monthly_discount_enabled = models.BooleanField(default=False)
    monthly_discount_percent = models.IntegerField(default=0)
    exterior_camera = models.BooleanField(default=False)
    noise_monitor = models.BooleanField(default=False)
    weapons_on_property = models.BooleanField(default=False)
    PRICING_TYPES = [
        ('nightly', 'Per Night'),
        ('monthly', 'Per Month'),
    ]
    PAYMENT_SCHEDULES = [
        ('monthly', 'Monthly'),
        ('quarterly', 'Every 3 Months'),
        ('biannual', 'Every 6 Months'),
        ('annual', 'Annual'),
    ]
    pricing_type = models.CharField(max_length=10, choices=PRICING_TYPES, default='nightly')
    payment_schedule = models.CharField(
        max_length=15, choices=PAYMENT_SCHEDULES, null=True, blank=True,
        help_text='Required for monthly-priced listings (room, apartment, house)',
    )
    lease_term_months = models.PositiveIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)],
        help_text='Lease length in months for long-term (monthly) listings — sets the booking end date. '
                   'Any positive number of months is allowed (the wizard offers 1/6/12/24/36-month presets plus a custom "Other" option).',
    )
    cancellation_policy = models.CharField(max_length=20, choices=CANCELLATION_POLICIES, default='flexible')
    is_available = models.BooleanField(default=True)
    # Listings publish immediately — no admin approval step for now. (Set to
    # 'pending_review' to re-enable the review queue + approve/reject flow.)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='published')
    # Soft-delete marker. Set when the host clicks "Delete listing". The row
    # is kept so historical bookings/payments/reviews still resolve, but the
    # listing is hidden from every public surface (search, detail page,
    # category pages) by an explicit `deleted_at__isnull=True` filter.
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    main_image = models.ImageField(upload_to='listings/main/', null=True, blank=True)

    # ── Agent-sourced properties ──────────────────────────────────────────
    # When a sourcing agent lists a property on an owner's behalf, `owner` is
    # the Home Konet Operations account (platform manages inquiries/bookings),
    # `sourced_by_agent` is the agent (earns commission, no management rights),
    # and the real owner is captured below as fields (no user account — the
    # owner may later "claim" via `claimed_by_user`).
    sourced_by_agent = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sourced_listings',
    )
    agent_owner_name           = models.CharField(max_length=255, blank=True, default='')
    agent_owner_phone          = models.CharField(max_length=30, blank=True, default='')
    agent_owner_email          = models.EmailField(blank=True, default='')
    agent_owner_payout_number  = models.CharField(max_length=30, blank=True, default='')
    agent_owner_payout_network = models.CharField(
        max_length=10, blank=True, default='',
        choices=[('mtn', 'MTN Mobile Money'), ('orange', 'Orange Money')],
    )
    claimed_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='claimed_listings',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def is_agent_sourced(self):
        return self.sourced_by_agent_id is not None

    # Set when Trust & Safety / Inventory staff take a published listing down
    # for a policy violation. Distinct from the host's own soft-delete
    # (deleted_at) — a suspension is reversible and host-visible as a status,
    # not a disappearance.
    suspended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='listings_suspended',
    )
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspension_reason = models.TextField(blank=True)

    # Local compliance metadata — set by Inventory/Compliance staff, not the
    # host. occupancy_cap (if set) is a legal ceiling imposed by the local
    # jurisdiction, independent of the host's own max_guests preference: a
    # host cannot raise max_guests above it (enforced in ListingSerializer).
    local_registration_number = models.CharField(
        max_length=100, blank=True, help_text='Local business/short-term-rental registration or license number.',
    )
    occupancy_cap = models.PositiveIntegerField(
        null=True, blank=True, help_text='Legal maximum occupancy for this address. max_guests may not exceed this once set.',
    )

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    listing = models.ForeignKey(Listing, related_name='gallery_images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='listings/gallery/')
    caption = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']
        unique_together = ['listing', 'order']

    def __str__(self):
        return f'{self.listing.title} - Image {self.order + 1}'


class Favorite(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorites")
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "listing")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} likes {self.listing.title}"


class Review(models.Model):
    RATING_CHOICES = [(i, f'{i} star{"s" if i > 1 else ""}') for i in range(1, 6)]

    listing = models.ForeignKey('Listing', on_delete=models.CASCADE, related_name='reviews')
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reviews')
    rating = models.IntegerField(choices=RATING_CHOICES)
    title = models.CharField(max_length=100, blank=True)
    content = models.TextField()
    cleanliness = models.IntegerField(null=True, blank=True)
    accuracy = models.IntegerField(null=True, blank=True)
    check_in_rating = models.IntegerField(null=True, blank=True)
    communication = models.IntegerField(null=True, blank=True)
    location_rating = models.IntegerField(null=True, blank=True)
    value = models.IntegerField(null=True, blank=True)
    host_response = models.TextField(blank=True, default='')
    host_response_at = models.DateTimeField(null=True, blank=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['listing', 'reviewer']
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.reviewer.username} - {self.listing.title} - ({self.rating} star(s))'


class ReviewImage(models.Model):
    review = models.ForeignKey(Review, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='reviews/')
    caption = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Image for {self.review}'


class PropertyView(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True)
    listing = models.ForeignKey('Listing', on_delete=models.CASCADE, related_name='property_views')
    ip_address = models.GenericIPAddressField()
    user_agent = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['listing', 'timestamp']),
            models.Index(fields=['timestamp']),
        ]

    def __str__(self):
        return f'View of {self.listing.title} at {self.timestamp}'


class PropertyStats(models.Model):
    listing = models.ForeignKey('Listing', on_delete=models.CASCADE, related_name='daily_stats')
    date = models.DateField()
    views = models.PositiveIntegerField(default=0)
    unique_views = models.PositiveIntegerField(default=0)
    favorites = models.PositiveIntegerField(default=0)
    bookings = models.PositiveIntegerField(default=0)
    revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        unique_together = ['listing', 'date']
        ordering = ['-date']
        indexes = [
            models.Index(fields=['listing', 'date']),
            models.Index(fields=['date']),
        ]

    def __str__(self):
        return f'Stats for {self.listing.title} on {self.date}'


class HotelRoom(models.Model):
    BED_TYPE_CHOICES = [
        ('king', 'King'), ('queen', 'Queen'), ('twin', 'Twin'),
        ('double', 'Double'), ('single', 'Single'), ('bunk', 'Bunk'),
    ]
    ROOM_TYPE_CHOICES = [
        ('standard', 'Standard'), ('deluxe', 'Deluxe'), ('suite', 'Suite'),
        ('family', 'Family'), ('studio', 'Studio'), ('penthouse', 'Penthouse'),
    ]

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='hotel_rooms')
    name = models.CharField(max_length=120)
    room_type = models.CharField(max_length=20, choices=ROOM_TYPE_CHOICES, default='standard')
    description = models.TextField(blank=True)
    price_per_night = models.DecimalField(max_digits=12, decimal_places=2)
    max_occupancy = models.PositiveIntegerField(default=2)
    beds = models.PositiveIntegerField(default=1)
    bed_type = models.CharField(max_length=20, choices=BED_TYPE_CHOICES, default='queen')
    bathrooms = models.PositiveIntegerField(default=1)
    amenities = models.JSONField(default=list, blank=True)
    total_count = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['room_type', 'price_per_night']

    def __str__(self):
        return f"{self.listing.title} — {self.name}"


class HotelRoomImage(models.Model):
    room = models.ForeignKey(HotelRoom, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='listings/rooms/')
    caption = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'{self.room.name} - Image {self.order + 1}'


class ListingSettings(models.Model):
    """
    Singleton configuration for listing-creation constraints.
    Edit via Django admin or the superadmin dashboard — only one row is ever
    stored. Mirrors payments.PlatformFee's singleton pattern.
    """
    min_monthly_price = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('5.00'),
        help_text='Minimum price (USD) a listing can be created or saved with. Enforced both in the create-listing wizard and server-side.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Listing Settings'
        verbose_name_plural = 'Listing Settings'

    def __str__(self):
        return f'Minimum listing price: ${self.min_monthly_price}'

    def save(self, *args, **kwargs):
        # Enforce singleton — only one configuration row allowed.
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # Prevent deletion of the singleton row

    @classmethod
    def get_current(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
