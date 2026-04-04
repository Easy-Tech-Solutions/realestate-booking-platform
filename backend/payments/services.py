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
    def create_payment(cls, booking, gateway_name: str, amount: float,
                       currency_code: str, payment_method: str, **kwargs) -> Payment:
        with transaction.atomic():
            currency = Currency.objects.get(code=currency_code)
            gateway = PaymentGateway.objects.get(name=gateway_name)

            payment = Payment.objects.create(
                booking=booking,
                gateway=gateway,
                user=booking.customer,
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

                if mtn_status == 'completed' and payment.status != 'completed':
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
            if mtn_status == 'SUCCESSFUL' and payment.status != 'completed':
                payment.status = 'completed'
                payment.completed_at = timezone.now()
                payment.save(update_fields=['status', 'completed_at', 'gateway_response'])
                cls._on_payment_confirmed(payment)

            elif mtn_status in ('FAILED', 'TIMEOUT'):
                payment.status = 'failed'
                payment.save(update_fields=['status', 'gateway_response'])

            else:
                payment.save(update_fields=['gateway_response'])

    @classmethod
    def _on_payment_confirmed(cls, payment: Payment) -> None:
        """
        Centralised post-payment logic:
          1. Confirm the booking.
          2. Disburse funds to the property owner.
        """
        # 1. Confirm booking
        booking = payment.booking
        booking.status = 'confirmed'
        booking.confirmed_at = timezone.now()
        booking.save(update_fields=['status', 'confirmed_at'])

        # 2. Disburse to owner
        cls.transfer_to_owner(payment)

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
