from django.db import models
from django.conf import settings


class Listing(models.Model):
    PROPERTY_TYPES = [
        ('house', 'House'),
        ('apartment', 'Apartment'),
        ('villa', 'Villa'),
        ('cabin', 'Cabin'),
        ('cottage', 'Cottage'),
        ('bungalow', 'Bungalow'),
        ('chalet', 'Chalet'),
        ('treehouse', 'Treehouse'),
        ('boat', 'Boat'),
        ('castle', 'Castle'),
        ('cave', 'Cave'),
        ('farm', 'Farm'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    bedrooms = models.IntegerField(default=0)
    property_type = models.CharField(max_length=50, choices=PROPERTY_TYPES)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='listings')
    address = models.CharField(max_length=200, blank=False)
    square_footage = models.IntegerField(default=0)
    is_available = models.BooleanField(default=True)
    main_image = models.ImageField(upload_to='listings/main/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
