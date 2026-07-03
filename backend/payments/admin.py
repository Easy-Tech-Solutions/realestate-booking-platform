from django.contrib import admin
from django.utils import timezone
from django.contrib import messages
from .models import PaymentGateway, Currency, Payment, Refund, WebhookLog, PlatformFee, Payout


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
    list_display = ['id', 'user', 'customer_full_name', 'purpose', 'booking', 'viewing', 'amount', 'currency', 'status', 'payment_method', 'created_at']
    list_filter = ['status', 'purpose', 'payment_method', 'gateway', 'currency']
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
    raw_id_fields = ['booking', 'viewing', 'user']
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
    list_display = ['service_fee_percent', 'viewing_fee', 'booking_fee', 'transaction_fee_type', 'transaction_fee_value', 'updated_at']
    readonly_fields = ['updated_at']
    fieldsets = (
        ('Service Fee', {
            'fields': ('service_fee_percent',),
            'description': (
                'Platform service fee percentage. Applied to BOTH sides of every booking: '
                'added on top of what the guest pays AND deducted from what the host receives. '
                'e.g. enter 4 to charge the guest +4% and pay the host −4% (the platform earns 8% overall). '
                'Edit here any time — no code change needed.'
            ),
        }),
        ('Viewing Appointment Fee', {
            'fields': ('viewing_fee',),
            'description': 'Flat, non-refundable fee a guest pays to book a long-term property viewing (in USD).',
        }),
        ('Booking Fee (legacy)', {
            'fields': ('booking_fee',),
            'classes': ('collapse',),
            'description': 'Legacy flat fee. No longer charged at reservation under the current booking flow.',
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


@admin.register(Payout)
class PayoutAdmin(admin.ModelAdmin):
    list_display = ['host_full_name', 'host_momo', 'booking', 'net_amount', 'currency', 'status', 'created_at']
    list_filter = ['status', 'currency', 'created_at']
    search_fields = [
        'host__username', 'host__first_name', 'host__last_name', 'host__email',
        'booking__listing__title', 'reference',
    ]
    # Everything except the disbursement details is system-computed at creation
    # time, so only status / reference / paid_by / notes are editable.
    readonly_fields = [
        'booking', 'host', 'host_momo', 'gross_amount', 'service_fee_amount',
        'net_amount', 'currency', 'created_at', 'updated_at', 'paid_at',
    ]
    date_hierarchy = 'created_at'
    actions = ['mark_paid']

    # Payouts are created automatically when an admin confirms a payment — they
    # are never hand-entered (the amounts are derived from the booking).
    def has_add_permission(self, request):
        return False

    @admin.display(description='Host', ordering='host__last_name')
    def host_full_name(self, obj):
        return obj.host.get_full_name() or obj.host.username

    @admin.display(description='Host MoMo #')
    def host_momo(self, obj):
        return getattr(getattr(obj.host, 'profile', None), 'momo_number', '') or '—'

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        # "Paid by" should only ever be a staff/admin user.
        if db_field.name == 'paid_by':
            kwargs['queryset'] = db_field.related_model.objects.filter(is_staff=True)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def save_model(self, request, obj, form, change):
        # Auto-stamp the disbursement metadata when an admin flips a payout to
        # "paid" on the change form (mirrors the bulk action).
        newly_paid = obj.status == 'paid' and (form.initial.get('status') if change else None) != 'paid'
        if obj.status == 'paid' and obj.paid_at is None:
            obj.paid_at = timezone.now()
            if obj.paid_by is None:
                obj.paid_by = request.user
        super().save_model(request, obj, form, change)
        if newly_paid:
            try:
                from notifications.services import notify_payout_paid
                notify_payout_paid(obj)
            except Exception:
                pass

    @admin.action(description='Mark selected payouts as paid')
    def mark_paid(self, request, queryset):
        from notifications.services import notify_payout_paid
        pending = list(queryset.filter(status='pending').select_related('host', 'booking__listing'))
        for payout in pending:
            payout.status = 'paid'
            payout.paid_at = timezone.now()
            payout.paid_by = request.user
            payout.save(update_fields=['status', 'paid_at', 'paid_by'])
            try:
                notify_payout_paid(payout)
            except Exception:
                pass
        self.message_user(request, f'{len(pending)} payout(s) marked as paid.', messages.SUCCESS)


@admin.register(WebhookLog)
class WebhookLogAdmin(admin.ModelAdmin):
    list_display = ['gateway', 'event_type', 'processed', 'created_at']
    list_filter = ['gateway', 'processed', 'event_type']
    readonly_fields = ['gateway', 'event_type', 'payload', 'processed', 'error_message', 'created_at']
