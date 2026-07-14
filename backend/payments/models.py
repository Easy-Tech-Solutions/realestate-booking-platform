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

    PAYMENT_PURPOSE_CHOICES = [
        ('booking', 'Booking / Rent'),
        ('viewing_fee', 'Viewing Appointment Fee'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Exactly one of booking / viewing is set, depending on `purpose`.
    booking = models.ForeignKey(
        'bookings.Booking', on_delete=models.CASCADE, related_name='payments',
        null=True, blank=True,
    )
    viewing = models.ForeignKey(
        'bookings.ViewingAppointment', on_delete=models.CASCADE, related_name='payments',
        null=True, blank=True,
    )
    purpose = models.CharField(max_length=20, choices=PAYMENT_PURPOSE_CHOICES, default='booking')
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

    # Home Konnect Business Policy §10 — only the first three are actually
    # eligible for a refund; CHANGE_OF_MIND exists so it can be explicitly
    # rejected with a clear reason rather than silently falling through.
    class ReasonCode(models.TextChoices):
        MISREPRESENTATION = 'misrepresentation', 'Property misrepresentation'
        LEGAL_ISSUE        = 'legal_issue',        'Legal issue discovered'
        SAFETY_CONCERN     = 'safety_concern',      'Safety concern'
        CHANGE_OF_MIND     = 'change_of_mind',      'Change of mind (not eligible)'
        OTHER              = 'other',               'Other (admin discretion)'

    ELIGIBLE_REASON_CODES = (ReasonCode.MISREPRESENTATION, ReasonCode.LEGAL_ISSUE, ReasonCode.SAFETY_CONCERN)

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='refunds')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField()
    reason_code = models.CharField(max_length=20, choices=ReasonCode.choices, default=ReasonCode.OTHER)
    gateway_refund_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=REFUND_STATUS_CHOICE, default='pending')

    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)


    class Meta:
        ordering = ['-created_at']

    
    def __str__(self):
        return f'Payment {self.id} - {self.amount} for Payment {self.payment.id}'
    

class Payout(models.Model):
    """
    Disbursement owed to a host after a guest payment is confirmed.

    All guest payments land in Home Konet's account; the host is paid out
    separately by the team. This record tracks what each host is owed and
    whether it has been paid, so admins always know the outstanding balance.

    net_amount = gross_amount (rent) − service_fee_amount (host's 4% commission).
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('cancelled', 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField('bookings.Booking', on_delete=models.CASCADE, related_name='payout')
    host = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='payouts')

    gross_amount = models.DecimalField(max_digits=12, decimal_places=2)       # rent the guest paid for the stay
    service_fee_amount = models.DecimalField(max_digits=12, decimal_places=2)  # platform commission deducted from host
    net_amount = models.DecimalField(max_digits=12, decimal_places=2)         # what the host receives
    currency = models.CharField(max_length=3, default='USD')

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    reference = models.CharField(max_length=255, blank=True, help_text='Disbursement transaction reference')
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payouts_processed',
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payouts_cancelled',
    )
    cancellation_reason = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Payout to {self.host.username} — {self.net_amount} {self.currency} ({self.status})'


class EscrowHold(models.Model):
    """A temporary freeze on releasing a booking's held guest payment — the
    real analog of 'finances.escrow' in the RBAC resource tree. Guest
    payments land in the platform account and sit there (booking status
    'payment_received') until an admin confirms and a Payout is created;
    an active hold on a booking blocks that confirmation, e.g. while a
    fraud flag or legal dispute on the booking is under investigation."""

    booking = models.ForeignKey('bookings.Booking', on_delete=models.CASCADE, related_name='escrow_holds')
    reason = models.TextField()
    held_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='escrow_holds_placed',
    )
    held_at = models.DateTimeField(auto_now_add=True)
    released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='escrow_holds_released',
    )

    class Meta:
        ordering = ['-held_at']

    def __str__(self):
        return f'Hold on booking #{self.booking_id} ({"active" if self.is_active else "released"})'

    @property
    def is_active(self):
        return self.released_at is None


class StripeRefund(models.Model):
    """Admin-triggered Stripe refund against a booking's rent payment.

    Separate from `Refund` (which is tied to the MTN-only `Payment` model)
    because Stripe payments never create a local Payment row — they're
    settled directly against Booking.stripe_payment_intent_id via webhook.
    This is the local ledger for Stripe refunds specifically, so repeated
    refund attempts can be clamped against what's already been refunded."""

    STATUS_CHOICES = [
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]

    booking = models.ForeignKey('bookings.Booking', on_delete=models.CASCADE, related_name='stripe_refunds')
    stripe_payment_intent_id = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField()
    reason_code = models.CharField(max_length=20, choices=Refund.ReasonCode.choices, default=Refund.ReasonCode.OTHER)
    stripe_refund_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    error_message = models.TextField(blank=True)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='stripe_refunds_initiated',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Stripe refund of {self.amount} on booking #{self.booking_id} ({self.status})'


class TaxRate(models.Model):
    """A local occupancy/lodging tax rate for a jurisdiction. There's no
    withholding, filing, or remittance automation here — matched against
    Listing.city (case-insensitive) to produce a real, computed tax
    liability report over actual booking totals, which is the honest scope
    a self-hosted platform this size can support without a tax-compliance
    vendor integration."""

    jurisdiction = models.CharField(max_length=100, unique=True, help_text='City/locality name, matched case-insensitively against Listing.city.')
    rate_percent = models.DecimalField(max_digits=5, decimal_places=2, help_text='Occupancy tax rate, e.g. 5.00 for 5%.')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tax_rates_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['jurisdiction']

    def __str__(self):
        return f'{self.jurisdiction} — {self.rate_percent}%'


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


class PlatformFee(models.Model):
    """
    Singleton configuration for platform-wide fees.
    Edit via Django admin — only one row is ever stored.
    """
    TRANSACTION_FEE_TYPES = [
        ('fixed', 'Fixed Amount (USD)'),
        ('percentage', 'Percentage of transaction'),
        ('range', 'Range (Min–Max USD)'),
    ]

    booking_fee = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal('3.00'),
        help_text='Flat fee charged at booking time (USD)',
    )
    viewing_fee = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal('3.00'),
        help_text='Flat fee charged for a long-term property viewing appointment (USD). Non-refundable.',
    )
    service_fee_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal('4.00'),
        help_text=(
            'Platform service fee, applied to BOTH sides of a booking: added on '
            'top of what the guest pays AND deducted from what the host receives. '
            'e.g. 4.00 means the platform earns 8% of the rent overall.'
        ),
    )
    transaction_fee_type = models.CharField(
        max_length=20, choices=TRANSACTION_FEE_TYPES, default='fixed',
        help_text='How the payment-method transaction fee is calculated',
    )
    transaction_fee_value = models.DecimalField(
        max_digits=8, decimal_places=4, default=Decimal('0.00'),
        help_text='Fixed USD amount or percentage rate (e.g. 2.9 for 2.9%)',
    )
    transaction_fee_min = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        help_text='Minimum USD fee (range type only)',
    )
    transaction_fee_max = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        help_text='Maximum USD fee (range type only)',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Platform Fee Configuration'
        verbose_name_plural = 'Platform Fee Configuration'

    def __str__(self):
        return f'Booking fee: ${self.booking_fee} | Transaction: {self.get_transaction_fee_type_display()}'

    def save(self, *args, **kwargs):
        # Enforce singleton — only one configuration row allowed.
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # Prevent deletion of the singleton row

    @classmethod
    def get_current(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def service_fee_rate(self) -> Decimal:
        """The service fee as a fraction (e.g. 0.04 for 4%)."""
        return (self.service_fee_percent or Decimal('0')) / Decimal('100')

    def compute_transaction_fee(self, amount_usd: Decimal) -> Decimal:
        """Return the transaction fee for a given amount."""
        if self.transaction_fee_type == 'fixed':
            return self.transaction_fee_value
        if self.transaction_fee_type == 'percentage':
            fee = amount_usd * self.transaction_fee_value / Decimal('100')
            return fee
        if self.transaction_fee_type == 'range':
            fee = amount_usd * Decimal('0.029')  # default 2.9% for range
            lo = self.transaction_fee_min or Decimal('0')
            hi = self.transaction_fee_max
            if fee < lo:
                return lo
            if hi and fee > hi:
                return hi
            return fee
        return Decimal('0')


def get_service_fee_rate() -> Decimal:
    """
    The platform service fee as a fraction (e.g. Decimal('0.04')).

    Single source of truth for the fee, read from the admin-editable
    PlatformFee singleton. The same rate is added on top of the guest's
    total and deducted from the host's payout — so the platform earns
    twice this rate overall.
    """
    return PlatformFee.get_current().service_fee_rate


def get_viewing_fee() -> Decimal:
    """The flat viewing-appointment fee (USD), read from PlatformFee."""
    return PlatformFee.get_current().viewing_fee


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
