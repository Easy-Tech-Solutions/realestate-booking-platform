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

            # Convert booking amount (stored in listing's native currency, LRD)
            # into the currency the user wants to pay in
            from payments.models import Currency as _Currency
            from decimal import Decimal as _D
            lrd_amount = booking.total_amount  # always in LRD (listing price × days)
            pay_currency = _Currency.objects.get(code=currency_code)
            lrd_currency = _Currency.objects.filter(code='LRD').first()
            if lrd_currency and pay_currency.code != 'LRD':
                # Convert: LRD → USD → target currency
                amount_usd = lrd_amount * lrd_currency.exchange_rate_to_usd
                amount_in_pay_currency = amount_usd / pay_currency.exchange_rate_to_usd
            else:
                amount_in_pay_currency = _D(str(lrd_amount))

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

    # Validate HMAC signature when webhook_secret is configured
    if gateway_config.webhook_secret:
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
