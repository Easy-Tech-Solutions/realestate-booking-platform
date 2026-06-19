import json

from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Payment, PaymentGateway, WebhookLog, SavedCard
from .serializers import (
    PaymentInitiateSerializer, PaymentVerifySerializer, RefundSerializer,
    PaymentSerializer, RefundDetailSerializer, SavedCardSerializer,
    ViewingPaymentInitiateSerializer,
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

            payment_data = {
                'amount': amount_in_pay_currency,
                'phone_number': phone_number,
                'currency': currency_code,
            }

            result = PaymentService.process_payment(payment, payment_data)

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
        try:
            payment = get_object_or_404(Payment, pk=serializer.validated_data['payment_id'])

            if payment.user != request.user:
                return Response({'success': False, 'error': 'Permission denied'},
                                status=status.HTTP_403_FORBIDDEN)

            result = PaymentService.verify_payment(payment)

            if result.get('success'):
                return Response({
                    'success': True,
                    'payment': PaymentSerializer(payment, context={'request': request}).data,
                    'verification': result,
                    'booking_status': payment.booking.status,
                })

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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def process_refund(request):
    serializer = RefundSerializer(data=request.data)

    if serializer.is_valid():
        try:
            payment = get_object_or_404(Payment, pk=serializer.validated_data['payment_id'])

            if payment.user != request.user:
                return Response({'success': False, 'error': 'Permission denied'},
                                status=status.HTTP_403_FORBIDDEN)

            if payment.status != 'completed':
                return Response({'success': False, 'error': 'Only completed payments can be refunded'},
                                status=status.HTTP_400_BAD_REQUEST)

            result = PaymentService.refund_payment(
                payment=payment,
                amount=serializer.validated_data['amount'],
                reason=serializer.validated_data['reason'],
            )

            if result.get('success'):
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
    try:
        payment = get_object_or_404(Payment, pk=payment_id)

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


def _is_admin(user):
    return user.role == 'admin' or user.is_superuser


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
        'created_at': p.created_at.isoformat(),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_payouts(request):
    """Admin: list host payouts, optionally filtered by ?status=pending|paid."""
    if not _is_admin(request.user):
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
    if not _is_admin(request.user):
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
        logger = logging.getLogger(__name__)
        logger.info(
            'stripe payment_intent.succeeded pi=%s type=%s listing=%s user=%s amount=%s',
            pi_id, pi_type, meta.get('listing_id'), meta.get('user_id'), pi.get('amount'),
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
