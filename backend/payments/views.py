import json
import logging

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from realestate_backend.app_logging import log_transaction

logger = logging.getLogger(__name__)

from rbac import dual_auth

from .models import Payment, PaymentGateway, WebhookLog, SavedCard, Refund, PlatformFee
from .serializers import (
    PaymentInitiateSerializer, PaymentVerifySerializer, RefundSerializer,
    PaymentSerializer, RefundDetailSerializer, SavedCardSerializer,
    ViewingPaymentInitiateSerializer, PlatformFeeSerializer, TaxRateSerializer,
)
from .services import PaymentService


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_payment(request):
    serializer = PaymentInitiateSerializer(data=request.data, context={'request': request})

    if serializer.is_valid():
        try:
            booking = serializer.validated_data['booking_id']
            gateway_name = serializer.validated_data['gateway']
            payment_method = serializer.validated_data['payment_method']
            phone_number = serializer.validated_data['phone_number']
            currency_code = serializer.validated_data['currency']

            # Listings are priced in USD; booking.total_price already
            # includes the guest-side service fee (set at booking creation
            # by compute_listing_pricing). Use it directly — no FX needed.
            from decimal import Decimal as _D
            amount_in_pay_currency = _D(str(booking.total_price or booking.total_amount))

            payment = PaymentService.create_payment(
                booking=booking,
                gateway_name=gateway_name,
                amount=amount_in_pay_currency,
                currency_code=currency_code,
                payment_method=payment_method,
                phone_number=phone_number,
                network_provider='MTN',
            )
            log_transaction(
                'payment_initiated',
                user_id=request.user.id,
                booking_id=booking.id,
                amount=amount_in_pay_currency,
                currency=currency_code,
                payment_method=payment_method,
                gateway=gateway_name,
            )

            payment_data = {
                'amount': amount_in_pay_currency,
                'phone_number': phone_number,
                'currency': currency_code,
            }

            result = PaymentService.process_payment(payment, payment_data)

            if result.get('success'):
                log_transaction(
                    'payment_processing_success',
                    user_id=request.user.id,
                    booking_id=booking.id,
                    gateway=gateway_name,
                    gateway_status='success',
                )
                return Response({
                    'success': True,
                    'payment': PaymentSerializer(payment, context={'request': request}).data,
                    'message': result.get('message', 'Payment request sent successfully'),
                }, status=status.HTTP_201_CREATED)

            log_transaction(
                'payment_processing_failed',
                user_id=request.user.id,
                booking_id=booking.id,
                gateway=gateway_name,
                gateway_status=result.get('error', 'unknown'),
            )
            return Response({
                'success': False,
                'error': result.get('error', 'Payment processing failed'),
                'details': result.get('details'),
                'debug': result.get('debug'),
            }, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response(
                {'success': False, 'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    return Response({'success': False, 'errors': serializer.errors},
                    status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def initiate_viewing_payment(request):
    """
    Initiate a mobile-money/bank payment of the non-refundable viewing fee.
    Mirrors initiate_payment but charges ViewingAppointment.viewing_fee and
    links the Payment to the viewing instead of a booking. (Stripe uses the
    dedicated create_viewing_fee_intent endpoint.)
    """
    serializer = ViewingPaymentInitiateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response({'success': False, 'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    try:
        viewing = serializer.validated_data['viewing_id']
        gateway_name = serializer.validated_data['gateway']
        payment_method = serializer.validated_data['payment_method']
        phone_number = serializer.validated_data['phone_number']
        currency_code = serializer.validated_data['currency']

        from decimal import Decimal as _D
        amount = _D(str(viewing.viewing_fee))

        payment = PaymentService.create_payment(
            viewing=viewing,
            gateway_name=gateway_name,
            amount=amount,
            currency_code=currency_code,
            payment_method=payment_method,
            phone_number=phone_number,
            network_provider='MTN',
        )

        result = PaymentService.process_payment(payment, {
            'amount': amount, 'phone_number': phone_number, 'currency': currency_code,
        })

        if result.get('success'):
            return Response({
                'success': True,
                'payment': PaymentSerializer(payment, context={'request': request}).data,
                'message': result.get('message', 'Payment request sent successfully'),
            }, status=status.HTTP_201_CREATED)

        return Response({
            'success': False,
            'error': result.get('error', 'Payment processing failed'),
            'details': result.get('details'),
        }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_payment(request):
    serializer = PaymentVerifySerializer(data=request.data)
    if serializer.is_valid():
        payment = get_object_or_404(Payment, pk=serializer.validated_data['payment_id'])
        try:
            if payment.user != request.user:
                return Response({'success': False, 'error': 'Permission denied'},
                                status=status.HTTP_403_FORBIDDEN)

            result = PaymentService.verify_payment(payment)

            if result.get('success'):
                log_transaction(
                    'payment_verified',
                    user_id=request.user.id,
                    booking_id=payment.booking_id,
                    gateway_status='verified',
                )
                return Response({
                    'success': True,
                    'payment': PaymentSerializer(payment, context={'request': request}).data,
                    'verification': result,
                    'booking_status': payment.booking.status,
                })

            log_transaction(
                'payment_verification_failed',
                user_id=request.user.id,
                booking_id=payment.booking_id,
                gateway_status=result.get('error', 'unknown'),
            )
            return Response({
                'success': False,
                'error': result.get('error', 'Payment verification failed'),
            }, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response(
                {'success': False, 'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    return Response({'success': False, 'errors': serializer.errors},
                    status=status.HTTP_400_BAD_REQUEST)


# Home Konnect Business Policy §10 — refund eligibility window and reason
# codes. 20 days is the outer bound the policy allows ("7 to 20 days
# depending on agreement"); staff can still be more conservative case-by-case
# via the admin refund tools, but the system enforces this as the hard ceiling.
REFUND_ELIGIBILITY_WINDOW_DAYS = 20


def _check_refund_eligibility(payment, reason_code, allow_staff_override=False):
    """Returns (ok, error_message). error_message is None when ok=True.
    `allow_staff_override` lets the admin-discretion refund tools bypass the
    date window (never the viewing-fee block or the change-of-mind block —
    those are absolute per policy)."""
    if payment.purpose == 'viewing_fee':
        return False, 'QA/viewing inspection fees are non-refundable.'

    if reason_code not in dict(Refund.ReasonCode.choices):
        return False, f'reason_code must be one of {[c[0] for c in Refund.ReasonCode.choices]}.'

    if reason_code == Refund.ReasonCode.CHANGE_OF_MIND:
        return False, 'Refunds are not available for a change of mind.'

    if not allow_staff_override and reason_code not in Refund.ELIGIBLE_REASON_CODES:
        return False, (
            'This reason is not eligible for a refund. Eligible reasons: '
            'property misrepresentation, a legal issue, or a safety concern.'
        )

    anchor = payment.completed_at or payment.created_at
    if not allow_staff_override and anchor:
        from django.utils import timezone as _tz
        days_elapsed = (_tz.now() - anchor).days
        if days_elapsed > REFUND_ELIGIBILITY_WINDOW_DAYS:
            return False, f'This payment is {days_elapsed} days old — refund requests must be made within {REFUND_ELIGIBILITY_WINDOW_DAYS} days.'

    return True, None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def process_refund(request):
    serializer = RefundSerializer(data=request.data)

    if serializer.is_valid():
        payment = get_object_or_404(Payment, pk=serializer.validated_data['payment_id'])
        try:
            if payment.user != request.user:
                return Response({'success': False, 'error': 'Permission denied'},
                                status=status.HTTP_403_FORBIDDEN)

            if payment.status != 'completed':
                return Response({'success': False, 'error': 'Only completed payments can be refunded'},
                                status=status.HTTP_400_BAD_REQUEST)

            reason_code = request.data.get('reason_code', '')
            eligible, error = _check_refund_eligibility(payment, reason_code, allow_staff_override=False)
            if not eligible:
                return Response({'success': False, 'error': error}, status=status.HTTP_400_BAD_REQUEST)

            result = PaymentService.refund_payment(
                payment=payment,
                amount=serializer.validated_data['amount'],
                reason=serializer.validated_data['reason'],
                reason_code=reason_code,
            )

            if result.get('success'):
                log_transaction(
                    'refund_processed',
                    user_id=request.user.id,
                    booking_id=payment.booking_id,
                    amount=serializer.validated_data['amount'],
                    gateway_status='refunded',
                )
                return Response({
                    'success': True,
                    'refund': RefundDetailSerializer(
                        payment.refunds.last(), context={'request': request}
                    ).data,
                    'message': 'Refund submitted successfully',
                })

            return Response({
                'success': False,
                'error': result.get('error', 'Refund processing failed'),
            }, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            return Response(
                {'success': False, 'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    return Response({'success': False, 'errors': serializer.errors},
                    status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_payments(request):
    try:
        payments = Payment.objects.filter(user=request.user).select_related(
            'booking', 'gateway', 'currency'
        ).order_by('-created_at')
        serializer = PaymentSerializer(payments, many=True, context={'request': request})
        return Response({
            'success': True,
            'payments': serializer.data,
            'count': payments.count(),
        })
    except Exception as e:
        return Response({'success': False, 'error': str(e)},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_detail(request, payment_id):
    payment = get_object_or_404(Payment, pk=payment_id)
    try:
        if payment.user != request.user:
            return Response({'success': False, 'error': 'Permission denied'},
                            status=status.HTTP_403_FORBIDDEN)

        return Response({
            'success': True,
            'payment': PaymentSerializer(payment, context={'request': request}).data,
        })
    except Exception as e:
        return Response({'success': False, 'error': str(e)},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _is_admin(user, resource=None):
    """Full admins (superadmin) always pass; is_staff accounts need the
    finance department (legacy) OR — when `resource` is given — a custom
    role granting that specific finances/customer_support resource
    directly."""
    from rbac.permissions import is_full_admin
    if is_full_admin(user):
        return True
    from superadmin.permissions import is_superadmin_staff, require_department
    if not (user and user.is_authenticated and is_superadmin_staff(user)):
        return False
    if require_department(user, 'finance'):
        return True
    if resource:
        from rbac.permissions import has_any_permission
        return has_any_permission(user, resource)
    return False


def _serialize_payout(p):
    return {
        'id': str(p.id),
        'booking_id': p.booking_id,
        'listing_title': p.booking.listing.title if p.booking_id else '',
        'host_name': (p.host.get_full_name() or p.host.username),
        'host_id': p.host_id,
        'gross_amount': str(p.gross_amount),
        'service_fee_amount': str(p.service_fee_amount),
        'net_amount': str(p.net_amount),
        'currency': p.currency,
        'status': p.status,
        'reference': p.reference,
        'paid_at': p.paid_at.isoformat() if p.paid_at else None,
        'cancelled_at': p.cancelled_at.isoformat() if p.cancelled_at else None,
        'cancellation_reason': p.cancellation_reason,
        'created_at': p.created_at.isoformat(),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_payouts(request):
    """Admin: list host payouts, optionally filtered by ?status=pending|paid."""
    if not _is_admin(request.user, 'finances.payouts'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    from .models import Payout
    qs = Payout.objects.select_related('host', 'booking__listing').order_by('-created_at')
    status_filter = request.GET.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)
    return Response([_serialize_payout(p) for p in qs])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_mark_payout_paid(request, payout_id):
    """Admin: mark a payout as paid (records who/when and an optional reference)."""
    if not _is_admin(request.user, 'finances.payouts'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    from django.utils import timezone as _tz
    from .models import Payout
    try:
        payout = Payout.objects.select_related('host', 'booking__listing').get(pk=payout_id)
    except Payout.DoesNotExist:
        return Response({'error': 'Payout not found'}, status=status.HTTP_404_NOT_FOUND)
    if payout.status != 'paid':
        payout.status = 'paid'
        payout.paid_at = _tz.now()
        payout.paid_by = request.user
        payout.reference = request.data.get('reference', '')
        payout.save(update_fields=['status', 'paid_at', 'paid_by', 'reference'])
        try:
            from notifications.services import notify_payout_paid
            notify_payout_paid(payout)
        except Exception:
            pass
    return Response(_serialize_payout(payout))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_cancel_payout(request, payout_id):
    """Admin: cancel a pending payout (e.g. a booking is disputed/refunded
    before the host has been paid). Only pending payouts can be cancelled —
    a paid one has already moved real money and must be reversed manually."""
    if not _is_admin(request.user, 'finances.payouts'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    from django.utils import timezone as _tz
    from .models import Payout
    try:
        payout = Payout.objects.select_related('host', 'booking__listing').get(pk=payout_id)
    except Payout.DoesNotExist:
        return Response({'error': 'Payout not found'}, status=status.HTTP_404_NOT_FOUND)
    if payout.status != 'pending':
        return Response({'error': f'Only pending payouts can be cancelled (this one is {payout.status}).'}, status=status.HTTP_400_BAD_REQUEST)
    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to cancel a payout.'}, status=status.HTTP_400_BAD_REQUEST)
    payout.status = 'cancelled'
    payout.cancelled_at = _tz.now()
    payout.cancelled_by = request.user
    payout.cancellation_reason = reason
    payout.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason'])

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'payout.cancel', target=payout, reason=reason)

    return Response(_serialize_payout(payout))


@csrf_exempt
def mtn_momo_webhook(request):
    """
    Receive MTN MoMo payment status callbacks.
    Validates the HMAC-SHA256 signature, updates payment + booking status,
    and triggers owner disbursement on successful payments.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    raw_body = request.body
    webhook_log = None

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    try:
        gateway_config = PaymentGateway.objects.get(name='mtn_momo', is_active=True)
    except PaymentGateway.DoesNotExist:
        return JsonResponse({'error': 'Gateway not configured'}, status=500)

    mtn_status = payload.get('status', 'unknown')

    # Log every incoming webhook before processing
    webhook_log = WebhookLog.objects.create(
        gateway=gateway_config,
        event_type=f'payment_{mtn_status.lower()}',
        payload=payload,
        processed=False,
    )

    # Signature validation is mandatory — reject the request if the secret is not configured.
    if not gateway_config.webhook_secret:
        if webhook_log:
            webhook_log.error_message = 'webhook_secret not configured; refusing to process unsigned webhook'
            webhook_log.save(update_fields=['error_message'])
        return JsonResponse({'error': 'Webhook secret not configured'}, status=500)

    signature = request.headers.get('X-Signature', '')
    gateway = PaymentService.get_gateway('mtn_momo')
    if not gateway or not gateway.validate_webhook(payload, signature):
        webhook_log.error_message = 'Invalid webhook signature'
        webhook_log.save(update_fields=['error_message'])
        return JsonResponse({'error': 'Invalid signature'}, status=401)

    # Look up the payment by our UUID embedded as externalId
    external_id = payload.get('externalId')
    try:
        payment = Payment.objects.select_related('booking', 'booking__listing__owner').get(
            id=external_id
        )
    except (Payment.DoesNotExist, Exception):
        webhook_log.error_message = f'Payment not found for externalId={external_id}'
        webhook_log.save(update_fields=['error_message'])
        return JsonResponse({'error': 'Payment not found'}, status=404)

    # Delegate all status/booking/payout logic to the service
    PaymentService.handle_webhook(payment, mtn_status, payload)

    webhook_log.processed = True
    webhook_log.save(update_fields=['processed'])

    return JsonResponse({'status': 'ok'})


# ── Stripe PaymentIntent ───────────────────────────────────────────────────────

def _get_booking_fee():
    """Return the current booking fee from PlatformFee config."""
    from .models import PlatformFee
    return float(PlatformFee.get_current().booking_fee)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_booking_fee_intent(request):
    """
    Creates a Stripe PaymentIntent for the booking fee only.
    Called at initial booking time — the property rental amount is collected
    separately via a PaymentRequest after owner-guest agreement.
    """
    from django.conf import settings as django_settings

    stripe_secret = getattr(django_settings, 'STRIPE_SECRET_KEY', '') or ''
    if not stripe_secret:
        return Response({'error': 'Stripe is not configured on the server'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    listing_id = request.data.get('listing_id')
    currency = request.data.get('currency', 'usd').lower()

    booking_fee_usd = _get_booking_fee()
    amount_cents = round(booking_fee_usd * 100)

    try:
        import stripe
        stripe.api_key = stripe_secret
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'user_id': str(request.user.id),
                'listing_id': str(listing_id) if listing_id else '',
                'type': 'booking_fee',
            },
        )
        return Response({'client_secret': intent.client_secret, 'amount_cents': amount_cents})
    except ImportError:
        return Response({'error': 'Stripe library is not installed on the server'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_viewing_fee_intent(request):
    """
    Creates a Stripe PaymentIntent for a property viewing fee. The amount is
    taken server-side from the viewing's stored (non-refundable) fee — never
    from the client. Settlement marks the viewing paid via the Stripe webhook.
    """
    from django.conf import settings as django_settings
    from bookings.models import ViewingAppointment

    stripe_secret = getattr(django_settings, 'STRIPE_SECRET_KEY', '') or ''
    if not stripe_secret:
        return Response({'error': 'Stripe is not configured on the server'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    viewing_id = request.data.get('viewing_id')
    currency = request.data.get('currency', 'usd').lower()

    try:
        viewing = ViewingAppointment.objects.get(pk=viewing_id, guest=request.user)
    except ViewingAppointment.DoesNotExist:
        return Response({'error': 'Viewing not found'}, status=status.HTTP_404_NOT_FOUND)

    if viewing.is_fee_paid:
        return Response({'error': 'Viewing fee already paid'}, status=status.HTTP_400_BAD_REQUEST)

    amount_cents = round(float(viewing.viewing_fee) * 100)

    try:
        import stripe
        stripe.api_key = stripe_secret
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'user_id': str(request.user.id),
                'viewing_id': str(viewing.id),
                'type': 'viewing_fee',
            },
        )
        return Response({'client_secret': intent.client_secret, 'amount_cents': amount_cents})
    except ImportError:
        return Response({'error': 'Stripe library is not installed on the server'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_booking_payment_intent(request):
    """
    Creates a Stripe PaymentIntent for the rent of a host-confirmed booking.
    The amount is the booking's stored total (rent + service fee), computed
    server-side — never trusted from the client. On success the Stripe webhook
    (type=property_payment) moves the booking to 'payment_received'.
    """
    from django.conf import settings as django_settings
    from bookings.models import Booking

    stripe_secret = getattr(django_settings, 'STRIPE_SECRET_KEY', '') or ''
    if not stripe_secret:
        return Response({'error': 'Stripe is not configured on the server'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    booking_id = request.data.get('booking_id')
    currency = request.data.get('currency', 'usd').lower()

    try:
        booking = Booking.objects.get(pk=booking_id, customer=request.user)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.status not in ('awaiting_payment', 'payment_requested'):
        return Response(
            {'error': f'This booking is not awaiting payment (status: {booking.status}).'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if booking.total_price is None:
        return Response({'error': 'Booking has no price set'}, status=status.HTTP_400_BAD_REQUEST)

    amount_cents = round(float(booking.total_price) * 100)

    try:
        import stripe
        stripe.api_key = stripe_secret
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'user_id': str(request.user.id),
                'booking_id': str(booking.id),
                'type': 'property_payment',
            },
        )
        return Response({'client_secret': intent.client_secret, 'amount_cents': amount_cents})
    except ImportError:
        return Response({'error': 'Stripe library is not installed on the server'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_stripe_payment_intent(request):
    """
    Creates a Stripe PaymentIntent whose amount is computed server-side from
    the listing and dates.  The client MUST NOT send amount_cents — accepting
    a client-controlled amount would allow price-manipulation attacks.
    """
    from datetime import date as _date
    from django.conf import settings as django_settings
    from listings.models import Listing, HotelRoom
    from listings.views import compute_listing_pricing

    stripe_secret = getattr(django_settings, 'STRIPE_SECRET_KEY', '') or ''
    if not stripe_secret:
        return Response({'error': 'Stripe is not configured on the server'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    listing_id  = request.data.get('listing_id')
    check_in_s  = request.data.get('check_in')
    check_out_s = request.data.get('check_out')
    room_id     = request.data.get('room_id')
    currency    = request.data.get('currency', 'usd').lower()

    if not listing_id or not check_in_s or not check_out_s:
        return Response(
            {'error': 'listing_id, check_in, and check_out are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        listing = Listing.objects.get(pk=listing_id, is_available=True)
    except Listing.DoesNotExist:
        return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)

    room = None
    if room_id:
        try:
            room = HotelRoom.objects.get(pk=room_id, listing=listing, is_active=True)
        except HotelRoom.DoesNotExist:
            return Response({'error': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        check_in  = _date.fromisoformat(check_in_s)
        check_out = _date.fromisoformat(check_out_s)
    except ValueError:
        return Response({'error': 'Invalid date format — use YYYY-MM-DD'}, status=status.HTTP_400_BAD_REQUEST)

    if check_in >= check_out:
        return Response({'error': 'check_out must be after check_in'}, status=status.HTTP_400_BAD_REQUEST)
    if check_in < _date.today():
        return Response({'error': 'check_in cannot be in the past'}, status=status.HTTP_400_BAD_REQUEST)

    # Compute canonical total — never trust the client-supplied amount.
    pricing     = compute_listing_pricing(listing, check_in, check_out, room=room)
    total_usd   = pricing['discounted_subtotal'] + pricing['service_fee'] + _BOOKING_FEE_USD
    amount_cents = round(total_usd * 100)

    try:
        import stripe
        stripe.api_key = stripe_secret
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={
                'user_id':    str(request.user.id),
                'listing_id': str(listing_id),
                'check_in':   check_in_s,
                'check_out':  check_out_s,
                'room_id':    str(room_id) if room_id else '',
            },
        )
        return Response({'client_secret': intent.client_secret, 'amount_cents': amount_cents})
    except ImportError:
        return Response({'error': 'Stripe library is not installed on the server'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except stripe.error.StripeError as e:
        return Response({'error': str(e.user_message or e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        return Response({'error': 'Could not create payment intent'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ── Stripe Webhook ────────────────────────────────────────────────────────────

@csrf_exempt
def stripe_webhook(request):
    """
    Receive Stripe event callbacks and verify the Stripe-Signature HMAC before
    processing anything.  An attacker POSTing a fake payment_intent.succeeded
    event without a valid signature must get HTTP 400 — not a booking upgrade.
    """
    from django.conf import settings as django_settings

    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    webhook_secret = getattr(django_settings, 'STRIPE_WEBHOOK_SECRET', '') or ''
    if not webhook_secret:
        return JsonResponse({'error': 'Webhook secret not configured'}, status=500)

    sig_header = request.headers.get('Stripe-Signature', '')
    if not sig_header:
        return JsonResponse({'error': 'Missing Stripe-Signature header'}, status=400)

    raw_body = request.body
    try:
        import stripe
        stripe.api_key = getattr(django_settings, 'STRIPE_SECRET_KEY', '')
        event = stripe.Webhook.construct_event(raw_body, sig_header, webhook_secret)
    except ImportError:
        return JsonResponse({'error': 'Stripe library not installed'}, status=500)
    except ValueError:
        return JsonResponse({'error': 'Invalid payload'}, status=400)
    except stripe.error.SignatureVerificationError:
        return JsonResponse({'error': 'Invalid signature'}, status=400)

    event_type = event['type']

    if event_type == 'payment_intent.succeeded':
        import logging
        from django.utils import timezone as _tz
        from bookings.models import Booking, PaymentRequest

        pi   = event['data']['object']
        meta = pi.get('metadata', {})
        pi_id = pi.get('id', '')
        pi_type = meta.get('type', '')
        log_transaction(
            f'stripe_{pi_type}_succeeded',
            user_id=meta.get('user_id'),
            booking_id=meta.get('booking_id'),
            tx_ref=pi_id,
            gateway='stripe',
            gateway_status='succeeded',
            amount=pi.get('amount'),
            listing_id=meta.get('listing_id'),
        )

        if pi_type == 'viewing_fee':
            # Viewing fee paid — mark the viewing so admins can schedule it.
            viewing_id = meta.get('viewing_id')
            if viewing_id:
                from bookings.models import ViewingAppointment
                from bookings.services import mark_viewing_fee_paid
                try:
                    viewing = ViewingAppointment.objects.get(pk=viewing_id)
                    viewing.stripe_payment_intent_id = pi_id
                    viewing.save(update_fields=['stripe_payment_intent_id'])
                    mark_viewing_fee_paid(viewing)
                except ViewingAppointment.DoesNotExist:
                    pass
        elif pi_type == 'booking_fee':
            # Booking fee paid — update status to 'requested' (booking confirmed pending owner review)
            booking_id = meta.get('booking_id')
            if booking_id:
                try:
                    booking = Booking.objects.get(pk=booking_id, status='requested')
                    booking.stripe_payment_intent_id = pi_id
                    booking.save(update_fields=['stripe_payment_intent_id'])
                except Booking.DoesNotExist:
                    pass
        elif pi_type == 'property_payment':
            # Full property payment — mark booking as payment_received; awaiting admin confirmation
            booking_id = meta.get('booking_id')
            if not booking_id:
                # Fall back: look up via PaymentRequest
                try:
                    pr = PaymentRequest.objects.get(stripe_payment_intent_id=pi_id)
                    pr.is_paid = True
                    pr.paid_at = _tz.now()
                    pr.save(update_fields=['is_paid', 'paid_at'])
                    booking = pr.booking
                    if booking.status == 'payment_requested':
                        booking.status = 'payment_received'
                        booking.save(update_fields=['status'])
                except PaymentRequest.DoesNotExist:
                    pass
            else:
                try:
                    # Current flow: the guest pays while the booking is in
                    # 'awaiting_payment'. 'payment_requested' is the legacy path.
                    booking = Booking.objects.get(
                        pk=booking_id,
                        status__in=['awaiting_payment', 'payment_requested'],
                    )
                    booking.stripe_payment_intent_id = pi_id
                    booking.save(update_fields=['stripe_payment_intent_id'])
                    # Move to payment_received and notify admins to confirm/disburse.
                    from bookings.services import mark_guest_paid
                    mark_guest_paid(booking)
                    try:
                        pr = booking.payment_request
                        pr.is_paid = True
                        pr.paid_at = _tz.now()
                        pr.stripe_payment_intent_id = pi_id
                        pr.save(update_fields=['is_paid', 'paid_at', 'stripe_payment_intent_id'])
                    except PaymentRequest.DoesNotExist:
                        pass
                except Booking.DoesNotExist:
                    pass

    return JsonResponse({'status': 'ok'})


# ── Saved Cards ───────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def saved_cards(request):
    if request.method == 'GET':
        cards = SavedCard.objects.filter(user=request.user)
        return Response(SavedCardSerializer(cards, many=True).data)

    serializer = SavedCardSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # If this is the user's first card, make it default automatically
    is_first = not SavedCard.objects.filter(user=request.user).exists()
    card = serializer.save(user=request.user, is_default=serializer.validated_data.get('is_default', False) or is_first)
    return Response(SavedCardSerializer(card).data, status=status.HTTP_201_CREATED)


@api_view(['PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def saved_card_detail(request, card_id):
    card = get_object_or_404(SavedCard, pk=card_id, user=request.user)

    if request.method == 'DELETE':
        card.delete()
        # If no cards remain or if we just deleted the default, promote the newest remaining card
        remaining = SavedCard.objects.filter(user=request.user)
        if remaining.exists() and not remaining.filter(is_default=True).exists():
            newest = remaining.first()
            newest.is_default = True
            newest.save(update_fields=['is_default'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = SavedCardSerializer(card, data=request.data, partial=(request.method == 'PATCH'))
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    card = serializer.save()
    return Response(SavedCardSerializer(card).data)


# ---------------------------------------------------------------------------
# Admin: platform fee configuration (the fake hardcoded "Settings" form this
# replaces was never wired to any endpoint at all — see PlatformFee model)
# ---------------------------------------------------------------------------

@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def admin_platform_fee(request):
    if not _is_admin(request.user, 'finances.platform_fee'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    fee = PlatformFee.get_current()
    if request.method == 'GET':
        return Response(PlatformFeeSerializer(fee).data)

    serializer = PlatformFeeSerializer(fee, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    fee = serializer.save()

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'platform_fee.update', target=fee, metadata_snapshot=PlatformFeeSerializer(fee).data)

    return Response(PlatformFeeSerializer(fee).data)


# ---------------------------------------------------------------------------
# Admin: escrow (finances.escrow — held guest payments awaiting confirmation)
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_escrow_list(request):
    """Every booking whose guest payment has landed in the platform account
    but hasn't been confirmed (and disbursed to the host) yet — the real
    'funds currently in escrow' view, plus whether each one is on hold."""
    from rbac.permissions import has_permission
    from .models import EscrowHold
    from bookings.models import Booking
    if not has_permission(request.user, 'finances.escrow', 'read'):
        return Response({'error': 'finances.escrow access required'}, status=status.HTTP_403_FORBIDDEN)

    bookings = Booking.objects.filter(status='payment_received').select_related('listing', 'customer').order_by('requested_at')
    holds_by_booking = {
        h.booking_id: h for h in EscrowHold.objects.filter(booking__in=bookings, released_at__isnull=True)
    }
    results = []
    for b in bookings:
        hold = holds_by_booking.get(b.id)
        results.append({
            'booking_id': b.id,
            'listing_title': b.listing.title,
            'guest_username': b.customer.username,
            'total_price': str(b.total_price) if b.total_price is not None else None,
            'requested_at': b.requested_at.isoformat() if b.requested_at else None,
            'on_hold': hold is not None,
            'hold_id': hold.id if hold else None,
            'hold_reason': hold.reason if hold else '',
        })
    return Response(results)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_escrow_hold(request, booking_id):
    from rbac.permissions import has_permission
    from .models import EscrowHold
    from bookings.models import Booking
    if not has_permission(request.user, 'finances.escrow', 'update'):
        return Response({'error': 'finances.escrow access required'}, status=status.HTTP_403_FORBIDDEN)

    booking = get_object_or_404(Booking, pk=booking_id)
    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to place a hold.'}, status=status.HTTP_400_BAD_REQUEST)
    if EscrowHold.objects.filter(booking=booking, released_at__isnull=True).exists():
        return Response({'error': 'This booking already has an active hold.'}, status=status.HTTP_400_BAD_REQUEST)

    hold = EscrowHold.objects.create(booking=booking, reason=reason, held_by=request.user)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'escrow.hold', target=hold, reason=reason)

    return Response({'id': hold.id, 'booking_id': booking.id, 'reason': hold.reason, 'held_at': hold.held_at.isoformat()}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_escrow_release(request, hold_id):
    from django.utils import timezone
    from rbac.permissions import has_permission
    from .models import EscrowHold
    if not has_permission(request.user, 'finances.escrow', 'update'):
        return Response({'error': 'finances.escrow access required'}, status=status.HTTP_403_FORBIDDEN)

    hold = get_object_or_404(EscrowHold, pk=hold_id)
    if not hold.is_active:
        return Response({'error': 'This hold has already been released.'}, status=status.HTTP_400_BAD_REQUEST)

    hold.released_at = timezone.now()
    hold.released_by = request.user
    hold.save(update_fields=['released_at', 'released_by'])

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'escrow.release', target=hold)

    return Response({'id': hold.id, 'booking_id': hold.booking_id, 'released_at': hold.released_at.isoformat()})


# ---------------------------------------------------------------------------
# Admin: taxes (finances.taxes — jurisdiction rates + computed liability)
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def admin_tax_rates(request):
    from rbac.permissions import has_permission
    from .models import TaxRate
    action = 'read' if request.method == 'GET' else 'update'
    if not has_permission(request.user, 'finances.taxes', action):
        return Response({'error': 'finances.taxes access required'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        return Response(TaxRateSerializer(TaxRate.objects.all(), many=True).data)

    serializer = TaxRateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    rate = serializer.save(created_by=request.user)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'tax_rate.create', target=rate, reason=f'{rate.jurisdiction} {rate.rate_percent}%')

    return Response(TaxRateSerializer(rate).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def admin_tax_rate_detail(request, pk):
    from rbac.permissions import has_permission
    from .models import TaxRate
    if not has_permission(request.user, 'finances.taxes', 'update'):
        return Response({'error': 'finances.taxes access required'}, status=status.HTTP_403_FORBIDDEN)

    rate = get_object_or_404(TaxRate, pk=pk)

    if request.method == 'DELETE':
        from superadmin.permissions import log_admin_action
        log_admin_action(request, 'tax_rate.delete', target=rate)
        rate.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = TaxRateSerializer(rate, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    rate = serializer.save()

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'tax_rate.update', target=rate, reason=f'{rate.jurisdiction} {rate.rate_percent}%')

    return Response(TaxRateSerializer(rate).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_tax_report(request):
    """Computed occupancy-tax liability over actual confirmed bookings,
    grouped by jurisdiction (Listing.city, matched case-insensitively
    against TaxRate.jurisdiction). No withholding/filing/remittance —
    this is real arithmetic over real booking totals, the honest scope of
    'tax' support without a tax-compliance vendor integration."""
    from decimal import Decimal
    from rbac.permissions import has_permission
    from .models import TaxRate
    from bookings.models import Booking
    if not has_permission(request.user, 'finances.taxes', 'read'):
        return Response({'error': 'finances.taxes access required'}, status=status.HTTP_403_FORBIDDEN)

    bookings = Booking.objects.filter(status__in=['confirmed', 'completed']).select_related('listing')
    since = request.query_params.get('since')
    until = request.query_params.get('until')
    if since:
        bookings = bookings.filter(requested_at__date__gte=since)
    if until:
        bookings = bookings.filter(requested_at__date__lte=until)

    rates = {r.jurisdiction.strip().lower(): r for r in TaxRate.objects.filter(is_active=True)}

    totals_by_jurisdiction = {}
    for b in bookings:
        city = (b.listing.city or '').strip().lower()
        rate = rates.get(city)
        if not rate or not b.total_price:
            continue
        bucket = totals_by_jurisdiction.setdefault(rate.jurisdiction, {'gross_total': Decimal('0'), 'tax_liability': Decimal('0'), 'booking_count': 0})
        bucket['gross_total'] += b.total_price
        bucket['tax_liability'] += (b.total_price * rate.rate_percent / Decimal('100')).quantize(Decimal('0.01'))
        bucket['booking_count'] += 1

    return Response({
        'by_jurisdiction': [
            {'jurisdiction': j, 'gross_total': str(v['gross_total']), 'tax_liability': str(v['tax_liability']), 'booking_count': v['booking_count']}
            for j, v in totals_by_jurisdiction.items()
        ],
    })


# ---------------------------------------------------------------------------
# Admin: Stripe refunds (rent/property payments only — see docstring below)
# ---------------------------------------------------------------------------

@dual_auth.register_executor('stripe_refund')
def _execute_stripe_refund(payload):
    from decimal import Decimal
    from django.conf import settings as django_settings
    from bookings.models import Booking
    from .models import StripeRefund

    booking = Booking.objects.get(pk=payload['booking_id'])
    amount = Decimal(payload['amount'])
    reason = payload['reason']
    reason_code = payload.get('reason_code') or Refund.ReasonCode.OTHER

    stripe_secret = getattr(django_settings, 'STRIPE_SECRET_KEY', '') or ''
    if not stripe_secret:
        StripeRefund.objects.create(
            booking=booking, stripe_payment_intent_id=booking.stripe_payment_intent_id,
            amount=amount, reason=reason, reason_code=reason_code, status='failed',
            error_message='Stripe is not configured on the server',
            initiated_by_id=payload['initiated_by_id'],
        )
        raise RuntimeError('Stripe is not configured on the server')

    import stripe
    stripe.api_key = stripe_secret
    amount_cents = int((amount * 100).to_integral_value())

    try:
        result = stripe.Refund.create(
            payment_intent=booking.stripe_payment_intent_id,
            amount=amount_cents,
            metadata={'admin_reason': reason[:490], 'booking_id': str(booking.id)},
        )
        StripeRefund.objects.create(
            booking=booking, stripe_payment_intent_id=booking.stripe_payment_intent_id,
            amount=amount, reason=reason, reason_code=reason_code, stripe_refund_id=result.id, status='completed',
            initiated_by_id=payload['initiated_by_id'],
        )
        return {'booking_id': booking.id, 'stripe_refund_id': result.id, 'status': 'completed'}
    except stripe.error.StripeError as e:
        StripeRefund.objects.create(
            booking=booking, stripe_payment_intent_id=booking.stripe_payment_intent_id,
            amount=amount, reason=reason, reason_code=reason_code, status='failed', error_message=str(e),
            initiated_by_id=payload['initiated_by_id'],
        )
        raise RuntimeError(f'Stripe refund failed: {e}')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_stripe_refund(request):
    """Admin-triggered refund for a booking paid via Stripe (property_payment
    PaymentIntents only — see Booking.stripe_payment_intent_id). Every
    request here is deferred to dual-authorization UNCONDITIONALLY,
    regardless of amount: unlike the MTN MoMo refund path (which reuses
    long-exercised code), this is the first Stripe refund code in the
    codebase, so a second admin always reviews before it ever calls Stripe."""
    if not _is_admin(request.user, 'finances.payouts'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    from decimal import Decimal, InvalidOperation
    from bookings.models import Booking
    from .models import StripeRefund

    booking_id = request.data.get('booking_id')
    reason = str(request.data.get('reason', '')).strip()
    reason_code = request.data.get('reason_code', Refund.ReasonCode.OTHER)
    if not booking_id or not reason:
        return Response({'error': 'booking_id and reason are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if reason_code not in dict(Refund.ReasonCode.choices):
        return Response({'error': f'reason_code must be one of {[c[0] for c in Refund.ReasonCode.choices]}.'}, status=status.HTTP_400_BAD_REQUEST)
    if reason_code == Refund.ReasonCode.CHANGE_OF_MIND:
        return Response({'error': 'Refunds are not available for a change of mind.'}, status=status.HTTP_400_BAD_REQUEST)

    booking = get_object_or_404(Booking, pk=booking_id)
    if not booking.stripe_payment_intent_id:
        return Response(
            {'error': 'This booking was not paid via Stripe (no payment intent on record). If it was paid via MTN MoMo, use the MoMo refund tool instead.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if booking.status not in ('confirmed', 'completed'):
        return Response({'error': f'Only a confirmed or completed booking can be refunded (this one is {booking.status}).'}, status=status.HTTP_400_BAD_REQUEST)
    if not booking.total_price:
        return Response({'error': 'This booking has no recorded total price.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        amount = Decimal(str(request.data.get('amount')))
    except (TypeError, InvalidOperation):
        return Response({'error': 'A valid amount is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if amount <= 0:
        return Response({'error': 'Amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)

    from django.db.models import Sum
    already_refunded = StripeRefund.objects.filter(booking=booking, status='completed').aggregate(total=Sum('amount'))['total'] or Decimal('0')
    remaining = Decimal(str(booking.total_price)) - already_refunded
    if amount > remaining:
        return Response({'error': f'Refund amount exceeds the remaining refundable balance ({remaining}).'}, status=status.HTTP_400_BAD_REQUEST)

    payload = {'booking_id': booking.id, 'amount': str(amount), 'reason': reason, 'reason_code': reason_code, 'initiated_by_id': request.user.id}
    _, approval = dual_auth.submit_or_execute('stripe_refund', payload, request.user, reason, True)

    from superadmin.permissions import log_admin_action
    log_admin_action(request, 'stripe_refund.requested', target=booking, reason=reason, amount=str(amount), approval_id=approval.id)

    return Response(
        {'pending_approval': True, 'approval_id': approval.id, 'message': 'Stripe refunds always require a second admin to approve before they execute.'},
        status=status.HTTP_202_ACCEPTED,
    )


# ---------------------------------------------------------------------------
# Admin: refunds
# ---------------------------------------------------------------------------

# Refunds above this amount require a second admin's sign-off (dual
# authorization) — see rbac.dual_auth. Chosen relative to this platform's
# typical booking-fee/rent scale, not an arbitrary round number.
DUAL_AUTH_REFUND_THRESHOLD = 500.00


@dual_auth.register_executor('payment.refund')
def _execute_refund(payload):
    payment = Payment.objects.get(pk=payload['payment_id'])
    result = PaymentService.refund_payment(
        payment=payment, amount=payload['amount'], reason=payload['reason'],
        reason_code=payload.get('reason_code', ''),
    )
    if not result.get('success'):
        raise RuntimeError(result.get('error', 'Refund processing failed'))
    payment.refresh_from_db()
    return {'payment_id': str(payment.id), 'status': payment.status, 'refund_id': result.get('refund_id')}


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_refund_payment(request):
    """Admin-triggered refund. MTN MoMo only for now — Stripe payments never
    create a Payment row (they're settled directly against Booking/
    ViewingAppointment via webhook), so there is no Stripe payment to look up
    here. Stripe refunds must be issued from the Stripe dashboard until that
    gap is closed with its own dedicated, carefully-tested integration.

    Refunds over DUAL_AUTH_REFUND_THRESHOLD are deferred as a PendingApproval
    instead of executing immediately — a different admin must approve them."""
    if not _is_admin(request.user, 'customer_support.vouchers'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    payment_id = request.data.get('payment_id')
    reason = str(request.data.get('reason', '')).strip()
    reason_code = request.data.get('reason_code', Refund.ReasonCode.OTHER)
    if not payment_id or not reason:
        return Response({'error': 'payment_id and reason are required.'}, status=status.HTTP_400_BAD_REQUEST)

    payment = get_object_or_404(Payment, pk=payment_id)

    if payment.gateway.name != 'mtn_momo':
        return Response(
            {'error': f'Refunds from this dashboard only support MTN MoMo payments. This payment used "{payment.gateway.name}" — issue that refund from the gateway\'s own dashboard.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if payment.status not in ('completed', 'partially_refunded'):
        return Response({'error': f'Only completed or partially-refunded payments can be refunded (this one is {payment.status}).'}, status=status.HTTP_400_BAD_REQUEST)

    # Staff discretion is allowed past the eligibility date window, but the
    # viewing-fee block and the change-of-mind block are absolute (policy §10).
    eligible, error = _check_refund_eligibility(payment, reason_code, allow_staff_override=True)
    if not eligible:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    try:
        amount = float(request.data.get('amount'))
    except (TypeError, ValueError):
        return Response({'error': 'A valid amount is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if amount <= 0:
        return Response({'error': 'Amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)

    from superadmin.permissions import log_admin_action
    payload = {'payment_id': str(payment.id), 'amount': amount, 'reason': reason, 'reason_code': reason_code}
    requires_dual_auth = amount > DUAL_AUTH_REFUND_THRESHOLD

    if requires_dual_auth:
        _, approval = dual_auth.submit_or_execute('payment.refund', payload, request.user, reason, True)
        log_admin_action(request, 'payment.refund.requested', target=payment, reason=reason, amount=amount, approval_id=approval.id)
        return Response(
            {'pending_approval': True, 'approval_id': approval.id, 'message': f'This refund exceeds ${DUAL_AUTH_REFUND_THRESHOLD:.2f} and requires a second admin to approve it before it executes.'},
            status=status.HTTP_202_ACCEPTED,
        )

    try:
        result, _ = dual_auth.submit_or_execute('payment.refund', payload, request.user, reason, False)
    except RuntimeError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    log_admin_action(request, 'payment.refund', target=payment, reason=reason, amount=amount)

    payment.refresh_from_db()
    return Response({
        'payment': PaymentSerializer(payment).data,
        'refund': RefundDetailSerializer(payment.refunds.last()).data,
    })


# ---------------------------------------------------------------------------
# Admin: financial reporting
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_financial_summary(request):
    """Revenue/refund/payout rollup for the finance dashboard. Everything is
    computed directly from existing Payment/Refund/Payout rows — no separate
    reporting pipeline. Optional ?since=/?until= (YYYY-MM-DD) filter on
    Payment.created_at."""
    if not _is_admin(request.user, 'finances'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    from django.db.models import Sum, Count, Q
    from .models import Payout

    payments = Payment.objects.all()
    since = request.query_params.get('since')
    until = request.query_params.get('until')
    if since:
        payments = payments.filter(created_at__date__gte=since)
    if until:
        payments = payments.filter(created_at__date__lte=until)

    collected = payments.filter(status__in=['completed', 'partially_refunded', 'refunded']).aggregate(
        total=Sum('amount_in_usd'))['total'] or 0
    refunded = Refund.objects.filter(status='completed', payment__in=payments).aggregate(
        total=Sum('amount'))['total'] or 0

    payouts = Payout.objects.all()
    payout_totals = payouts.aggregate(
        pending_total=Sum('net_amount', filter=Q(status='pending')),
        paid_total=Sum('net_amount', filter=Q(status='paid')),
        commission_total=Sum('service_fee_amount'),
        pending_count=Count('id', filter=Q(status='pending')),
        paid_count=Count('id', filter=Q(status='paid')),
        cancelled_count=Count('id', filter=Q(status='cancelled')),
    )

    return Response({
        'gross_collected': collected,
        'total_refunded': refunded,
        'net_revenue': collected - refunded,
        'commission_revenue': payout_totals['commission_total'] or 0,
        'payouts': {
            'pending_total': payout_totals['pending_total'] or 0,
            'pending_count': payout_totals['pending_count'],
            'paid_total': payout_totals['paid_total'] or 0,
            'paid_count': payout_totals['paid_count'],
            'cancelled_count': payout_totals['cancelled_count'],
        },
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_transactions_list(request):
    """Paginated, filterable list of every Payment — the closest thing to a
    'view all transactions' screen; independent of the 10-row recent-payments
    snippet on the general admin overview."""
    if not _is_admin(request.user, 'finances'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    qs = Payment.objects.select_related('gateway', 'currency', 'user', 'booking__listing')
    qs = _filter_transactions(qs, request.query_params)

    try:
        limit = max(1, min(int(request.query_params.get('limit', 25)), 100))
        offset = max(0, int(request.query_params.get('offset', 0)))
    except (ValueError, TypeError):
        limit, offset = 25, 0

    total = qs.count()
    page = qs[offset:offset + limit]
    return Response({
        'count': total, 'limit': limit, 'offset': offset,
        'results': PaymentSerializer(page, many=True).data,
    })


def _filter_transactions(qs, params):
    status_filter = params.get('status')
    purpose_filter = params.get('purpose')
    gateway_filter = params.get('gateway')
    since = params.get('since')
    until = params.get('until')
    search = params.get('search', '').strip()

    if status_filter:
        qs = qs.filter(status=status_filter)
    if purpose_filter:
        qs = qs.filter(purpose=purpose_filter)
    if gateway_filter:
        qs = qs.filter(gateway__name=gateway_filter)
    if since:
        qs = qs.filter(created_at__date__gte=since)
    if until:
        qs = qs.filter(created_at__date__lte=until)
    if search:
        from django.db.models import Q as _Q
        qs = qs.filter(
            _Q(user__username__icontains=search) | _Q(user__email__icontains=search)
            | _Q(gateway_transaction_id__icontains=search)
        )
    return qs


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_transactions_export(request):
    """CSV export of transactions matching the same filters as the list
    endpoint. Capped at 5000 rows so an unfiltered export can't hang the
    request — narrow with ?since=/?until=/?status= for a full pull."""
    if not _is_admin(request.user, 'finances'):
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    import csv
    from django.http import HttpResponse

    qs = Payment.objects.select_related('gateway', 'currency', 'user').order_by('-created_at')
    qs = _filter_transactions(qs, request.query_params)

    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="transactions.csv"'
    writer = csv.writer(response)
    writer.writerow([
        'id', 'created_at', 'purpose', 'gateway', 'user', 'amount', 'currency',
        'amount_in_usd', 'status', 'gateway_transaction_id',
    ])
    for p in qs[:5000]:
        writer.writerow([
            str(p.id), p.created_at.isoformat(), p.purpose, p.gateway.name,
            p.user.username, p.amount, p.currency.code, p.amount_in_usd,
            p.status, p.gateway_transaction_id,
        ])
    return response
