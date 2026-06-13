from django.contrib import admin
from .models import PaymentGateway, Currency, Payment, Refund, WebhookLog, PlatformFee


@admin.register(PaymentGateway)
class PaymentGatewayAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_active', 'sandbox_mode', 'created_at']
    list_filter = ['is_active', 'sandbox_mode', 'name']
    search_fields = ['name']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Basic Info', {
            'fields': ('name', 'is_active', 'sandbox_mode')
        }),
        ('API Credentials', {
            'fields': ('api_key', 'secret_key', 'webhook_secret', 'merchant_id', 'business_number'),
            'classes': ('collapse',),
            'description': 'For MTN MoMo: api_key=Collection Subscription Key, secret_key=Collection API Key, merchant_id=Collection User ID, business_number=Disbursement Subscription Key'
        }),
        ('URLs', {
            'fields': ('sandbox_url', 'live_url'),
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )


@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'symbol', 'exchange_rate_to_usd', 'is_active']
    list_filter = ['is_active']
    search_fields = ['code', 'name']


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'customer_full_name', 'booking', 'amount', 'currency', 'status', 'payment_method', 'created_at']
    list_filter = ['status', 'payment_method', 'gateway', 'currency']
    # Searching by full name works via the ORM's double-underscore traversal:
    # `user__first_name` resolves to the User row's first_name column at query
    # time, so we never duplicate the name onto the Payment row.
    search_fields = [
        'id',
        'user__username',
        'user__first_name',
        'user__last_name',
        'user__email',
        'phone_number',
        'gateway_transaction_id',
    ]
    readonly_fields = ['id', 'created_at', 'processed_at', 'completed_at', 'amount_in_usd', 'gateway_response']
    raw_id_fields = ['booking', 'user']
    date_hierarchy = 'created_at'

    @admin.display(description='Full name', ordering='user__last_name')
    def customer_full_name(self, obj):
        return obj.user.get_full_name() or '—'


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    list_display = ['id', 'payment', 'customer_full_name', 'amount', 'status', 'created_at']
    list_filter = ['status']
    # The Refund row links to a Payment, which links to a User — so we traverse
    # two FKs (payment__user__...) to display and search by the underlying
    # customer name without storing it on the Refund row itself.
    search_fields = [
        'id',
        'payment__user__username',
        'payment__user__first_name',
        'payment__user__last_name',
        'payment__user__email',
    ]
    readonly_fields = ['created_at', 'processed_at']

    @admin.display(description='Customer (Full name)', ordering='payment__user__last_name')
    def customer_full_name(self, obj):
        return obj.payment.user.get_full_name() or obj.payment.user.username


@admin.register(PlatformFee)
class PlatformFeeAdmin(admin.ModelAdmin):
    list_display = ['booking_fee', 'transaction_fee_type', 'transaction_fee_value', 'updated_at']
    readonly_fields = ['updated_at']
    fieldsets = (
        ('Booking Fee', {
            'fields': ('booking_fee',),
            'description': 'Flat fee charged to the guest at booking time (in USD). This is independent of the property rental price.',
        }),
        ('Transaction Fee (added to guest total at payment)', {
            'fields': ('transaction_fee_type', 'transaction_fee_value', 'transaction_fee_min', 'transaction_fee_max'),
            'description': (
                'Fixed: add a flat USD amount. '
                'Percentage: e.g. enter 2.9 for 2.9%. '
                'Range: percentage bounded by min/max USD values.'
            ),
        }),
        ('Last Updated', {
            'fields': ('updated_at',),
            'classes': ('collapse',),
        }),
    )

    def has_add_permission(self, request):
        return not PlatformFee.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(WebhookLog)
class WebhookLogAdmin(admin.ModelAdmin):
    list_display = ['gateway', 'event_type', 'processed', 'created_at']
    list_filter = ['gateway', 'processed', 'event_type']
    readonly_fields = ['gateway', 'event_type', 'payload', 'processed', 'error_message', 'created_at']
