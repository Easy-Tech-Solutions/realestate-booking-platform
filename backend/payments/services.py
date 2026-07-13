from decimal import Decimal
from typing import Dict, Any, Optional
from django.db import transaction, models
from django.utils import timezone
from .models import Payment, PaymentGateway, Currency, Refund
from .gateways.mtn_momo import MTNMoMoGateway


class PaymentService:
    GATEWAY_CLASSES = {
        'mtn_momo': MTNMoMoGateway,
    }

    @classmethod
    def get_gateway(cls, gateway_name: str) -> Optional[MTNMoMoGateway]:
        try:
            gateway_config = PaymentGateway.objects.get(name=gateway_name, is_active=True)
            gateway_class = cls.GATEWAY_CLASSES[gateway_name]
            return gateway_class(gateway_config)
        except (PaymentGateway.DoesNotExist, KeyError):
            return None

    @classmethod
    def create_payment(cls, gateway_name: str, amount: float,
                       currency_code: str, payment_method: str,
                       booking=None, viewing=None, **kwargs) -> Payment:
        """Create a pending Payment for either a booking (rent) or a viewing fee.

        Exactly one of `booking` / `viewing` must be supplied. Works the same
        for every gateway — only the purpose and the linked object differ.
        """
        if (booking is None) == (viewing is None):
            raise ValueError('Provide exactly one of booking or viewing')

        with transaction.atomic():
            currency = Currency.objects.get(code=currency_code)
            gateway = PaymentGateway.objects.get(name=gateway_name)

            payment = Payment.objects.create(
                booking=booking,
                viewing=viewing,
                purpose='booking' if booking else 'viewing_fee',
                gateway=gateway,
                user=booking.customer if booking else viewing.guest,
                amount=amount,
                currency=currency,
                payment_method=payment_method,
                **kwargs
            )
            return payment

    @classmethod
    def process_payment(cls, payment: Payment, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Initiate a Request-to-Pay through MTN MoMo.
        The payment stays in 'pending' because MoMo is asynchronous —
        the customer must approve the push on their phone. Final status
        arrives via webhook (or polling with verify_payment).
        """
        gateway = cls.get_gateway(payment.gateway.name)
        if not gateway:
            return {'success': False, 'error': 'Payment gateway not available'}

        try:
            payment.status = 'processing'
            payment.processed_at = timezone.now()
            payment.save(update_fields=['status', 'processed_at'])

            # Pass our payment UUID so the gateway can embed it as externalId
            payment_data['payment_id'] = str(payment.id)
            result = gateway.process_payment(payment_data)

            if result.get('success'):
                # Store the MTN reference UUID — NOT 'completed' yet (async flow)
                payment.gateway_transaction_id = result.get('transaction_id', '')
                payment.gateway_response = result
                payment.status = 'pending'
                payment.save(update_fields=['gateway_transaction_id', 'gateway_response', 'status'])
            else:
                payment.gateway_response = result
                payment.status = 'failed'
                payment.save(update_fields=['gateway_response', 'status'])

            return result

        except Exception as e:
            payment.status = 'failed'
            payment.gateway_response = {'error': str(e)}
            payment.save(update_fields=['status', 'gateway_response'])
            return {'success': False, 'error': str(e)}

    @classmethod
    def verify_payment(cls, payment: Payment) -> Dict[str, Any]:
        """
        Poll the MTN API for the current transaction status and sync it locally.
        If confirmed, updates booking status and triggers owner payout.
        """
        gateway = cls.get_gateway(payment.gateway.name)
        if not gateway:
            return {'success': False, 'error': 'Payment gateway not available'}

        try:
            result = gateway.verify_payment(payment.gateway_transaction_id)

            if result.get('success'):
                mtn_status = result.get('status')  # 'pending' | 'completed' | 'failed'

                if mtn_status == 'completed':
                    # Atomic so the payment-completed flag and its side effects
                    # (mark viewing/booking) commit together — never one without
                    # the other. _on_payment_confirmed runs even if the payment
                    # was already marked completed, so a previously-failed side
                    # effect self-heals on the next poll (it is idempotent).
                    with transaction.atomic():
                        if payment.status != 'completed':
                            payment.status = 'completed'
                            payment.completed_at = timezone.now()
                            payment.gateway_response = result
                            payment.save(update_fields=['status', 'completed_at', 'gateway_response'])
                        cls._on_payment_confirmed(payment)

                elif mtn_status == 'failed':
                    payment.status = 'failed'
                    payment.gateway_response = result
                    payment.save(update_fields=['status', 'gateway_response'])

            return result

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def handle_webhook(cls, payment: Payment, mtn_status: str,
                       payload: Dict[str, Any]) -> None:
        """
        Called by the webhook view after signature validation.
        Updates payment and booking, then triggers owner payout.
        """
        with transaction.atomic():
            payment.gateway_response = payload
            if mtn_status == 'SUCCESSFUL':
                if payment.status != 'completed':
                    payment.status = 'completed'
                    payment.completed_at = timezone.now()
                    payment.save(update_fields=['status', 'completed_at', 'gateway_response'])
                else:
                    payment.save(update_fields=['gateway_response'])
                # Idempotent — safe to run even if already completed.
                cls._on_payment_confirmed(payment)

            elif mtn_status in ('FAILED', 'TIMEOUT'):
                payment.status = 'failed'
                payment.save(update_fields=['status', 'gateway_response'])

            else:
                payment.save(update_fields=['gateway_response'])

    @classmethod
    def _on_payment_confirmed(cls, payment: Payment) -> None:
        """
        Centralised post-payment logic, routed by what was paid for.

        Viewing fee: mark the viewing as paid so admins can schedule the visit.

        Booking/rent: move the reservation to 'payment_received'. All funds are
        held in the platform's account; an admin then confirms the payment
        (which finalizes the booking and creates the host Payout). We do NOT
        auto-confirm or auto-forward funds here — that preserves the escrow
        guarantee and the admin verification step.
        """
        if payment.purpose == 'viewing_fee' or payment.viewing_id:
            from bookings.services import mark_viewing_fee_paid
            mark_viewing_fee_paid(payment.viewing, payment=payment)
            return

        from bookings.services import mark_guest_paid
        mark_guest_paid(payment.booking)

    @classmethod
    def transfer_to_owner(cls, payment: Payment) -> Dict[str, Any]:
        """
        Disburse the booking amount to the property owner's registered MoMo number.
        Requires the owner's Profile to have a momo_number set.
        """
        gateway = cls.get_gateway(payment.gateway.name)
        if not gateway:
            return {'success': False, 'error': 'Payment gateway not available'}

        owner = payment.booking.listing.owner
        try:
            owner_momo = owner.profile.momo_number
        except Exception:
            owner_momo = None

        if not owner_momo:
            return {
                'success': False,
                'error': f'Owner {owner.username} has no MoMo number registered. '
                         'Payout skipped — disburse manually.',
            }

        return gateway.transfer_to_owner(
            owner_phone=owner_momo,
            amount=float(payment.amount),
            currency=payment.currency.code,
            booking_ref=str(payment.booking.id),
        )

    @classmethod
    def refund_payment(cls, payment: Payment, amount: float, reason: str) -> Dict[str, Any]:
        gateway = cls.get_gateway(payment.gateway.name)
        if not gateway:
            return {'success': False, 'error': 'Payment gateway not available'}

        # Failed refund attempts don't consume balance; pending/processing/completed do,
        # so two concurrent refund requests can't both slip through under the cap.
        already_refunded = (
            payment.refunds.exclude(status='failed').aggregate(total=models.Sum('amount'))['total']
            or Decimal('0')
        )
        remaining = payment.amount - already_refunded
        if Decimal(str(amount)) > remaining:
            return {
                'success': False,
                'error': f'Refund amount exceeds the remaining refundable balance ({remaining} {payment.currency.code}).',
            }

        try:
            with transaction.atomic():
                refund = Refund.objects.create(
                    payment=payment,
                    amount=amount,
                    reason=reason,
                )

                result = gateway.refund_payment(payment, amount, reason)

                if result.get('success'):
                    refund.gateway_refund_id = result.get('refund_id', '')
                    refund.status = 'completed'
                    refund.processed_at = timezone.now()

                    total_refunded = (
                        payment.refunds.aggregate(total=models.Sum('amount'))['total'] or 0
                    )
                    if payment.amount <= total_refunded:
                        payment.status = 'refunded'
                    else:
                        payment.status = 'partially_refunded'
                else:
                    refund.status = 'failed'

                refund.save()
                payment.save(update_fields=['status'])
                return result

        except Exception as e:
            return {'success': False, 'error': str(e)}
