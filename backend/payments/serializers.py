from rest_framework import serializers
from .models import Payment, Currency, Refund, SavedCard, PlatformFee, TaxRate
from bookings.models import Booking, ViewingAppointment

# Mobile-money / bank gateways routed through PaymentService (Stripe uses its
# own PaymentIntent endpoints).
_GATEWAY_CHOICES = ['mtn_momo', 'flutterwave', 'orange_money', 'paystack']


def _validate_gateway(value):
    if value not in _GATEWAY_CHOICES:
        raise serializers.ValidationError("Invalid payment gateway")
    return value


def _validate_currency(value):
    if not Currency.objects.filter(code=value, is_active=True).exists():
        raise serializers.ValidationError("Currency not supported")
    return value


class PaymentInitiateSerializer(serializers.ModelSerializer):
    #Serializer for initiating payments
    booking_id = serializers.IntegerField()
    gateway = serializers.CharField(max_length=20)
    payment_method = serializers.CharField(max_length=20)
    phone_number = serializers.CharField(max_length=20)
    currency = serializers.CharField(max_length=3)

    class Meta:
        model = Payment
        fields = ['booking_id', 'gateway', 'payment_method', 'phone_number', 'currency']


    def validate_booking_id(self,value):
        try:
            booking = Booking.objects.get(pk=value, customer=self.context['request'].user)
            # New flow: rent is paid once the host has confirmed the reservation.
            # 'requested' is accepted for legacy rows.
            if booking.status not in ('awaiting_payment', 'requested'):
                raise serializers.ValidationError("Booking must be awaiting payment")
            if booking.payments.filter(status__in=['completed', 'processing']).exists():
                raise serializers.ValidationError("Payment already exists for this booking")
            return booking
        except Booking.DoesNotExist:
            raise serializers.ValidationError("Booking not found")


    def validate_gateway(self, value):
        return _validate_gateway(value)


    def validate_currency(self, value):
        return _validate_currency(value)


class ViewingPaymentInitiateSerializer(serializers.Serializer):
    """Initiate a (mobile-money/bank) payment of the non-refundable viewing fee."""
    viewing_id = serializers.IntegerField()
    gateway = serializers.CharField(max_length=20)
    payment_method = serializers.CharField(max_length=20)
    phone_number = serializers.CharField(max_length=20)
    currency = serializers.CharField(max_length=3)

    def validate_viewing_id(self, value):
        try:
            viewing = ViewingAppointment.objects.get(pk=value, guest=self.context['request'].user)
        except ViewingAppointment.DoesNotExist:
            raise serializers.ValidationError("Viewing not found")
        if viewing.is_fee_paid:
            raise serializers.ValidationError("Viewing fee already paid")
        if viewing.status != 'requested':
            raise serializers.ValidationError("Fee can only be paid for a newly requested viewing")
        if viewing.payments.filter(status__in=['completed', 'processing']).exists():
            raise serializers.ValidationError("A payment is already in progress for this viewing")
        return viewing

    def validate_gateway(self, value):
        return _validate_gateway(value)

    def validate_currency(self, value):
        return _validate_currency(value)
    

class PaymentVerifySerializer(serializers.Serializer):
    #Serializer for payment verification
    payment_id = serializers.UUIDField()
    gateway = serializers.CharField(max_length=20)


class RefundSerializer(serializers.Serializer):
    #Serializer for refund requests
    payment_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    reason = serializers.CharField(max_length=500)


class PaymentSerializer(serializers.ModelSerializer):
    #Serializer for payment details
    gateway_name = serializers.CharField(source='gateway.name', read_only=True)
    currency_code = serializers.CharField(source='currency.code', read_only=True)
    currency_symbol = serializers.CharField(source='currency.symbol', read_only=True)
    booking_title = serializers.CharField(source='booking.listing.title', read_only=True)
    customer_username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = Payment
        fields = [
            'id', 'booking', 'booking_title', 'viewing', 'purpose', 'user', 'customer_username',
            'gateway', 'gateway_name', 'amount', 'currency', 'currency_code',
            'currency_symbol', 'payment_method', 'status', 'phone_number',
            'card_last4', 'card_type', 'created_at', 'completed_at'
        ]
        read_only_fields = ['id', 'created_at', 'completed_at']


class RefundDetailSerializer(serializers.ModelSerializer):
    #Serializer for refund details
    payment_gateway = serializers.CharField(source='payment.gateway.name', read_only=True)
    payment_amount = serializers.DecimalField(source='payment.amount', max_digits=12, decimal_places=2, read_only=True)
    payment_currency = serializers.CharField(source='payment.currency.code', read_only=True)
    
    class Meta:
        model = Refund
        fields = [
            'id', 'payment', 'payment_gateway', 'payment_amount', 'payment_currency',
            'amount', 'reason', 'status', 'gateway_refund_id', 
            'created_at', 'processed_at'
        ]
        read_only_fields = ['id', 'created_at', 'processed_at']


class SavedCardSerializer(serializers.ModelSerializer):
    card_type_display = serializers.CharField(source='get_card_type_display', read_only=True)

    class Meta:
        model = SavedCard
        fields = [
            'id', 'cardholder_name', 'last4', 'card_type', 'card_type_display',
            'expiry_month', 'expiry_year', 'is_default', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'card_type_display']

    def validate_last4(self, value):
        if not value.isdigit() or len(value) != 4:
            raise serializers.ValidationError('last4 must be exactly 4 digits.')
        return value

    def validate_expiry_month(self, value):
        if not value.isdigit() or not (1 <= int(value) <= 12):
            raise serializers.ValidationError('expiry_month must be 01-12.')
        return value.zfill(2)

    def validate_expiry_year(self, value):
        if not value.isdigit() or len(value) != 4:
            raise serializers.ValidationError('expiry_year must be a 4-digit year.')
        return value


class MTNWebhookSerializer(serializers.Serializer):
    #Serializer for MTN Mobile Money webhook data
    transactionId = serializers.CharField()
    externalId = serializers.CharField()
    amount = serializers.CharField()
    currency = serializers.CharField()
    status = serializers.CharField()
    financialTransactionId = serializers.CharField()
    payer = serializers.DictField()
    creationDate = serializers.DateTimeField()
    
    def validate_status(self, value):
        valid_statuses = ['PENDING', 'SUCCESSFUL', 'FAILED', 'TIMEOUT']
        if value not in valid_statuses:
            raise serializers.ValidationError(f"Invalid status: {value}")
        return value


class PlatformFeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlatformFee
        fields = [
            'booking_fee', 'viewing_fee', 'service_fee_percent',
            'transaction_fee_type', 'transaction_fee_value',
            'transaction_fee_min', 'transaction_fee_max', 'updated_at',
        ]
        read_only_fields = ['updated_at']

    def validate(self, attrs):
        fee_type = attrs.get('transaction_fee_type', getattr(self.instance, 'transaction_fee_type', 'fixed'))
        if fee_type == 'range':
            lo = attrs.get('transaction_fee_min', getattr(self.instance, 'transaction_fee_min', None))
            hi = attrs.get('transaction_fee_max', getattr(self.instance, 'transaction_fee_max', None))
            if lo is not None and hi is not None and lo > hi:
                raise serializers.ValidationError({'transaction_fee_min': 'Minimum cannot exceed maximum.'})
        return attrs


class TaxRateSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', default=None, read_only=True)

    class Meta:
        model = TaxRate
        fields = ['id', 'jurisdiction', 'rate_percent', 'is_active', 'created_by', 'created_by_username', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_by', 'created_by_username', 'created_at', 'updated_at']  