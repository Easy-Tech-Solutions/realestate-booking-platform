"""
Create host payouts for confirmed bookings that are missing one.

This repairs bookings that were confirmed by editing the status field directly
(or under older code) so no Payout row was ever created. Idempotent — a booking
that already has a payout is skipped.

    python manage.py backfill_payouts            # all confirmed bookings
    python manage.py backfill_payouts 33 41      # only these booking ids
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Create missing host payouts for confirmed bookings (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('booking_ids', nargs='*', type=int,
                            help='Optional booking ids to limit to.')

    def handle(self, *args, **options):
        from bookings.models import Booking
        from bookings.services import create_payout_for_booking

        qs = Booking.objects.filter(status='confirmed').select_related('listing', 'customer')
        ids = options.get('booking_ids')
        if ids:
            qs = qs.filter(id__in=ids)

        created = 0
        skipped = 0
        for booking in qs:
            if hasattr(booking, 'payout'):
                skipped += 1
                continue
            payout = create_payout_for_booking(booking)
            if payout:
                created += 1
                self.stdout.write(
                    f'  payout for booking {booking.id} ({booking.listing.title}): '
                    f'net ${payout.net_amount} → {payout.host.username}'
                )

        self.stdout.write(self.style.SUCCESS(
            f'Backfill complete: {created} payout(s) created, {skipped} already had one.'
        ))
