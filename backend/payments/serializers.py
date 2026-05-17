from rest_framework import serializers
from .models import Payment, Currency, Refund, SavedCard
from bookings.models import Booking

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
            if booking.status != 'requested':
                raise serializers.ValidationError("Booking must be in 'requested' status")
            if booking.payments.filter(status__in=['completed', 'processing']).exists():
                raise serializers.ValidationError("Payment already exists for this booking")
            return booking
        except Booking.DoesNotExist:
            raise serializers.ValidationError("Booking not found")
    

    def validate_gateway(self, value):
        if value not in ['mtn_momo', 'flutterwave', 'orange_money']:
            raise serializers.ValidationError("Invalid payment gateway")
        return value
    

    def validate_currency(self, value):
        if not Currency.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Currency not supported")
        return value
    

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
            'id', 'booking', 'booking_title', 'user', 'customer_username',
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