from django.db import models
from django.conf import settings
from decimal import Decimal
import uuid

class PaymentGateway(models.Model):
    GATEWAY_CHOICES = [
        ('flutterwave', 'FlutterWave'),
        ('mtn_momo', 'MTN Mobile Money'),
        ('orange_money', 'Orange Money'),
        ('paystack', 'PayStack'),
    ]

    name = models.CharField(max_length=50, choices=GATEWAY_CHOICES, unique=True)
    is_active = models.BooleanField(default=True)
    api_key = models.CharField(max_length=255, blank=True)     #Encrypted in Production
    secret_key = models.CharField(max_length=255, blank=True)  #Encrypted in Production
    webhook_secret = models.CharField(max_length=255, blank=True)
    sandbox_mode = models.BooleanField(default=True)

    #API URLs
    sandbox_url = models.CharField(max_length=255, blank=True)
    live_url = models.CharField(max_length=255, blank=True)

    #Gateway-specific settings
    merchant_id = models.CharField(max_length=100, blank=True)  #API user_id for MTN MoMo
    business_number = models.CharField(max_length=20, blank=True)   #Disbursement subscription key for MTN MoMo

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.get_name_display()
    

class Currency(models.Model):
    code = models.CharField(max_length=3, unique=True)   #LRD, USD
    name = models.CharField(max_length=50)
    symbol = models.CharField(max_length=5)
    exchange_rate_to_usd = models.DecimalField(max_digits=10,decimal_places=4)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['code']

    def __str__(self):
        return f'{self.code} - {self.name}'
    

class Payment(models.Model):
    PAYMENT_STATUS_CHOICE = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
        ('refunded', 'Refunded'),
        ('partially_refunded', 'Partially Refunded'),
    ]


    PAYMENT_METHOD_CHOICES = [
        ('card', 'Bank Card'),
        ('mobile_money', 'Mobile Money'),
        ('bank_transfer', 'Bank Transfer'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey('bookings.Booking', on_delete=models.CASCADE, related_name='payments')
    gateway = models.ForeignKey(PaymentGateway, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    #Amount details
    amount = models.DecimalField(max_digits=12,decimal_places=2)
    currency = models.ForeignKey(Currency, on_delete=models.PROTECT)
    amount_in_usd = models.DecimalField(max_digits=12, decimal_places=2)   #For reporting

    #Payment method details
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    gateway_transaction_id = models.CharField(max_length=255, blank=True)
    gateway_response = models.JSONField(default=dict)   #Store gateway response

    #Status and timestamps
    status = models.CharField(max_length=20, choices=PAYMENT_STATUS_CHOICE, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    #MoMo and Orange Money specific 
    phone_number = models.CharField(max_length=20, blank=True)
    network_provider = models.CharField(max_length=20, blank=True)   #MTN, Orange

    #Card specific
    card_last4 = models.CharField(max_length=4, blank=True)   #Last 4 digits of card
    card_type = models.CharField(max_length=20, blank=True)   #Visa, Mastercard
    card_country = models.CharField(max_length=3, blank=True)


    class Meta:
        ordering = ['-created_at']

    
    def __str__(self):
        return f'Payment {self.id} - {self.amount} {self.currency.code}'
    
    def save(self, *args, **kwargs):
        #Calculate USD amount
        if self.currency and self.amount:
            self.amount_in_usd = Decimal(str(self.amount)) / self.currency.exchange_rate_to_usd
        super().save(*args, **kwargs)


class Refund(models.Model):
    REFUND_STATUS_CHOICE = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='refunds')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField()
    gateway_refund_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=REFUND_STATUS_CHOICE, default='pending')

    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)


    class Meta:
        ordering = ['-created_at']

    
    def __str__(self):
        return f'Payment {self.id} - {self.amount} for Payment {self.payment.id}'
    

class SavedCard(models.Model):
    CARD_TYPE_CHOICES = [
        ('visa', 'Visa'),
        ('mastercard', 'Mastercard'),
        ('amex', 'American Express'),
        ('discover', 'Discover'),
        ('other', 'Other'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='saved_cards',
    )
    cardholder_name = models.CharField(max_length=100)
    last4 = models.CharField(max_length=4)
    card_type = models.CharField(max_length=20, choices=CARD_TYPE_CHOICES, default='other')
    expiry_month = models.CharField(max_length=2)
    expiry_year = models.CharField(max_length=4)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_default', '-created_at']

    def __str__(self):
        return f'{self.get_card_type_display()} •••• {self.last4} ({self.user.username})'

    def save(self, *args, **kwargs):
        # Ensure only one default card per user
        if self.is_default:
            SavedCard.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class WebhookLog(models.Model):
    gateway = models.ForeignKey(PaymentGateway, on_delete=models.CASCADE)
    event_type = models.CharField(max_length=50)
    payload = models.JSONField()
    processed = models.BooleanField(default=False)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    
    def __str__(self):
        return f'Webhook {self.event_type} from {self.gateway.name}'
