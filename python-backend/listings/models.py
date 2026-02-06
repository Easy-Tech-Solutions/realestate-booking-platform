from django.db import models

from django.conf import settings

class Listing(models.Model):

    PROPERTY_TYPES = [

        ('house', 'House'),

        ('apartment', 'Apartment'),

    ]

    title = models.CharField(max_length=200)

    description = models.TextField(blank=True)

    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    bedrooms = models.IntegerField(default=0)

    property_type = models.CharField(max_length = 50, choices=PROPERTY_TYPES)

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='listings')

    address = models.CharField(max_length=200, blank=False)

    square_footage = models.IntegerField(default=0)

    is_available = models.BooleanField(default=True)

    main_image = models.ImageField(

        upload_to='listings/main/',

        null=True,

        blank=True,

    )

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

        return f'{self.listing.title} - Image {self.order+1}'



class Favorite(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    listing = models.ForeignKey(
        Listing,
        on_delete=models.CASCADE,
        related_name="favorited_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "listing")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} ♥ {self.listing.title}"