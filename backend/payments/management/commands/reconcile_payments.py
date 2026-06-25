"""
Reconcile completed payments with their bookings/viewings.

Fixes the case where a Payment was marked 'completed' but its side effect never
ran (e.g. the older non-atomic verify path left a viewing with is_fee_paid=False
or a booking that never advanced to payment_received). Re-runs the idempotent
post-payment logic for every completed payment.

    python manage.py reconcile_payments
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Re-apply post-payment side effects for completed payments (idempotent).'

    def handle(self, *args, **options):
        from payments.models import Payment
        from payments.services import PaymentService

        completed = Payment.objects.filter(status='completed').select_related('booking', 'viewing')
        fixed_viewings = 0
        fixed_bookings = 0
        total = 0

        for payment in completed:
            total += 1
            before_viewing = payment.viewing.is_fee_paid if payment.viewing_id else None
            before_booking = payment.booking.status if payment.booking_id else None

            PaymentService._on_payment_confirmed(payment)

            if payment.viewing_id:
                payment.viewing.refresh_from_db()
                if before_viewing is False and payment.viewing.is_fee_paid:
                    fixed_viewings += 1
                    self.stdout.write(f'  fixed viewing fee: payment {payment.id} → viewing {payment.viewing_id}')
            if payment.booking_id:
                payment.booking.refresh_from_db()
                if before_booking in ('awaiting_payment', 'pending_host', 'requested') \
                        and payment.booking.status == 'payment_received':
                    fixed_bookings += 1
                    self.stdout.write(f'  advanced booking: payment {payment.id} → booking {payment.booking_id}')

        self.stdout.write(self.style.SUCCESS(
            f'Reconciled {total} completed payment(s): '
            f'{fixed_viewings} viewing fee(s), {fixed_bookings} booking(s) fixed.'
        ))
