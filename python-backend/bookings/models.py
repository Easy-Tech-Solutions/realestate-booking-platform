from django.db import models
from django.conf import settings
from listings.models import Listing
import uuid

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


class SavedSearch(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='saved_searches')
    name = models.CharField(max_length=100, help_text='Name for this saved search')

    #Search criteria
    min_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    max_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    property_type = models.CharField(max_length=50, choices=Listing.PROPERTY_TYPES, null=True, blank=True)
    min_bedrooms = models.IntegerField(null=True, blank=True)
    max_bedrooms = models.IntegerField(null=True, blank=True)
    min_square_footage = models.IntegerField(null=True, blank=True)
    max_square_footage = models.IntegerField(null=True, blank=True)
    address = models.CharField(max_length=200, blank=True)

    #Search preferences
    keywords = models.CharField(max_length=200, blank=True)
    is_available = models.BooleanField(default=True)

    #Notification settings
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
    name = models.CharField(max_length=100, help_text='Name for this comparison')
    is_public = models.BooleanField(default=False, help_text='Share with others')
    share_token = models.CharField(max_length=32,blank=True, null=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
    

    def __str__(self):
        return f'{self.user.username} - {self.name}'
    

    def save(self,*args, **kwargs):
        # Generate share token if public and no token exists
        if self.is_public and not self.share_token:
            self.share_token = uuid.uuid4().hex

        super().save(*args, **kwargs)


class ComparisonItem(models.Model):
    comparison = models.ForeignKey(PropertyComparison, on_delete=models.CASCADE, related_name='items')
    listing = models.ForeignKey('listings.Listing', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, help_text='User notes about this property')


    class Meta:
        unique_together = ['comparison','listing']
        ordering = ['order']

    def __str__(self):
        return f'{self.comparison.name} - {self.listing.title}'
