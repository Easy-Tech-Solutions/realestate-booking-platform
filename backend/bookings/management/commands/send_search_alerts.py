from django.core.management.base import BaseCommand
from django.utils import timezone
from django.core.mail import send_mail
from django.template.loader import render_to_string
from bookings.models import SavedSearch, SearchAlert
from listings.models import Listing
from django.db.models import Q

class Command(BaseCommand):
    help = 'Send search alerts for new matching listings'

    def handle(self, *args, **options):
        today = timezone.now().date()
        yesterday = today - timezone.timedelta(days=1)

        # Get all active saved searches
        saved_searches = SavedSearch.objects.filter(is_active=True)

        for search in saved_searches:
            # Find new listings since last alert
            last_alert = search.alerts.first()
            if last_alert:
                cutoff_date = last_alert.sent_at.date()
            else:
                cutoff_date = yesterday

            # Build query for this search
            query = self.build_search_query(search)
            new_listings = Listing.objects.filter(
                query,
                created_at__date__gte=cutoff_date
            ).exclude(
                id__in=search.alerts.values('listing_id')
            )

            for listing in new_listings:
                alert = SearchAlert.objects.create(
                    saved_search=search,
                    listing=listing
                )

                # Send email if configured
                if search.email_frequency in ['instant', 'daily']:
                    self.send_alert_email(search.user, listing, search)
            
            self.stdout.write(
                self.style.SUCCESS(f'Sent {len(new_listings)} alerts for search: {search.name}')
            )

    def build_search_query(self, search):
        """Build Django Q object from saved search"""
        query = Q()
        
        if search.min_price:
            query &= Q(price__gte=search.min_price)
        if search.max_price:
            query &= Q(price__lte=search.max_price)
        if search.property_type:
            query &= Q(property_type=search.property_type)
        if search.min_bedrooms:
            query &= Q(bedrooms__gte=search.min_bedrooms)
        if search.max_bedrooms:
            query &= Q(bedrooms__lte=search.max_bedrooms)
        if search.min_square_footage:
            query &= Q(square_footage__gte=search.min_square_footage)
        if search.max_square_footage:
            query &= Q(square_footage__lte=search.max_square_footage)
        if search.address:
            query &= Q(address__icontains=search.address)
        if search.keywords:
            query &= Q(title__icontains=search.keywords) | Q(description__icontains=search.keywords)
        if search.is_available:
            query &= Q(is_available=search.is_available)
        
        return query
    
    def send_alert_email(self, user, listing, search):
        """Send alert email to user"""
        subject = f"New Property Match: {listing.title}"
        
        context = {
            'user': user,
            'listing': listing,
            'search': search,
            'site_url': 'http://localhost:8000'
        }
        
        message = render_to_string('emails/search_alert.html', context)

        try:
            send_mail(
                subject,
                message,
                'noreply@realestate.com',
                [user.email],
                html_message=message,
                fail_silently=True,
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'Failed to send email to {user.email}: {e}')
            )