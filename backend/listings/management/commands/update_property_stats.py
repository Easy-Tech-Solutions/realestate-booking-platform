from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import date, timedelta
from django.db.models import Count, Sum, Q
from listings.models import PropertyStats, PropertyView, Favorite, Listing
from bookings.models import Booking

#Handles updating property stats
class Command(BaseCommand):
    help = 'Update daily property statistics'

    def handle(self, *args, **options):
        today = timezone.now().date
        yesterday = today - timedelta(days=1)

        #Get all listings
        listings = Listing.objects.all()

        for listing in listings:
            views = PropertyView.objects.filter(listing=listing, timestamp__date=yesterday).count()  #Count views for yesterday
            unique_views = PropertyView.objects.filter(listing=listing,timestamp__date=yesterday).values('ip_address').distinct().count()   #Count unique views
            favorites = Favorite.objects.filter(listing=listing, created_at__date=yesterday).count()   #Count new favorites
            bookings = Booking.objects.filter(listing=listing, created_at__date=yesterday).count()   #Count new bookings
            revenue = Booking.objects.filter(listing=listing, status='confirmed',create_at__date=yesterday).aggregate(total=Sum('listing__price'))['total'] or 0   #Calculate revenue from confirmed bookings

            #Update or create stats
            PropertyStats.objects.update_or_create(
                listing=listing,
                date=yesterday,
                defaults={
                    'views': views,
                    'unique_views': unique_views,
                    'favorites': favorites,
                    'bookings': bookings,
                    'revenue': revenue,
                }
            )
        
        self.stdout.write(self.style.SUCCESS(f'Succesfully updated property stats for {yesterday}'))