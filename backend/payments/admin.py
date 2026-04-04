from django.contrib import admin
from .models import PaymentGateway, Currency, Payment, Refund, WebhookLog


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
    list_display = ['id', 'user', 'booking', 'amount', 'currency', 'status', 'payment_method', 'created_at']
    list_filter = ['status', 'payment_method', 'gateway', 'currency']
    search_fields = ['id', 'user__username', 'phone_number', 'gateway_transaction_id']
    readonly_fields = ['id', 'created_at', 'processed_at', 'completed_at', 'amount_in_usd', 'gateway_response']
    raw_id_fields = ['booking', 'user']
    date_hierarchy = 'created_at'


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    list_display = ['id', 'payment', 'amount', 'status', 'created_at']
    list_filter = ['status']
    readonly_fields = ['created_at', 'processed_at']


@admin.register(WebhookLog)
class WebhookLogAdmin(admin.ModelAdmin):
    list_display = ['gateway', 'event_type', 'processed', 'created_at']
    list_filter = ['gateway', 'processed', 'event_type']
    readonly_fields = ['gateway', 'event_type', 'payload', 'processed', 'error_message', 'created_at']
