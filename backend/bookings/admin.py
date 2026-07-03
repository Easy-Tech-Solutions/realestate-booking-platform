from django.contrib import admin
from django.db import models
from django.utils import timezone
from django.contrib import messages
from .models import Booking, PaymentRequest, ViewingAppointment


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ['listing', 'customer_full_name', 'start_date', 'end_date', 'status', 'requested_at']
    list_filter = ['status', 'requested_at', 'start_date']
    search_fields = [
        'listing__title',
        'customer__username',
        'customer__first_name',
        'customer__last_name',
        'customer__email',
        'notes',
    ]
    readonly_fields = ['requested_at', 'confirmed_at', 'declined_at']
    actions = ['confirm_bookings', 'decline_bookings']

    def save_model(self, request, obj, form, change):
        """Flipping the status to 'confirmed' in the change form should create
        the host payout too — not just via the 'Confirm payment' action — so an
        admin editing the field directly still gets the disbursement record."""
        old_status = form.initial.get('status') if change else None
        super().save_model(request, obj, form, change)
        if obj.status == 'confirmed' and old_status != 'confirmed' and not hasattr(obj, 'payout'):
            from .services import create_payout_for_booking
            payout = create_payout_for_booking(obj)
            if payout:
                try:
                    from notifications.services import notify_payout_pending
                    notify_payout_pending(payout)
                except Exception:
                    pass
                self.message_user(request, f'Host payout created (net ${payout.net_amount}).', messages.SUCCESS)

        # Reaching 'payment_received' should tell the host their money is in and
        # a disbursement is coming (mirrors the guest-payment path).
        if obj.status == 'payment_received' and old_status != 'payment_received':
            try:
                from notifications.services import notify_host_payment_received
                notify_host_payment_received(obj)
            except Exception:
                pass

        # Changing the status to a "released" state should put the listing back
        # on the market (unless another booking still holds it) — mirrors the
        # guest-cancel / host-decline / expiry paths.
        RELEASING = {'cancelled', 'declined', 'expired_unconfirmed', 'expired_unpaid'}
        if change and obj.status in RELEASING and old_status not in RELEASING:
            from .services import release_listing_if_unheld
            if release_listing_if_unheld(obj.listing, exclude_booking=obj):
                self.message_user(
                    request, 'Listing is available again (no active booking holds it).', messages.INFO,
                )

    @admin.display(description='Customer', ordering='customer__last_name')
    def customer_full_name(self, obj):
        return obj.customer.get_full_name() or obj.customer.username

    @admin.action(description='Confirm payment (creates host payout, shares contact)')
    def confirm_bookings(self, request, queryset):
        # Route through the service so each confirmation also creates the host
        # Payout, shares the host's contact, and fires notifications. A bare
        # queryset.update() would skip all of that and leave nothing to disburse.
        # Self-healing: a booking already 'confirmed' but missing its payout
        # (e.g. confirmed under older code) gets its payout backfilled.
        from .services import admin_confirm_payment, create_payout_for_booking
        confirmed = 0
        backfilled = 0
        for booking in queryset:
            if booking.status == 'payment_received':
                admin_confirm_payment(booking, admin_user=request.user)
                confirmed += 1
            elif booking.status == 'confirmed' and not hasattr(booking, 'payout'):
                create_payout_for_booking(booking)
                backfilled += 1
        parts = []
        if confirmed:
            parts.append(f'{confirmed} booking(s) confirmed')
        if backfilled:
            parts.append(f'{backfilled} missing payout(s) created')
        if parts:
            self.message_user(request, '; '.join(parts) + ' — ready to disburse.', messages.SUCCESS)
        else:
            self.message_user(
                request,
                'Nothing to do — selected bookings are not awaiting payment and already have payouts.',
                messages.WARNING,
            )

    @admin.action(description='Decline selected bookings (relists the property)')
    def decline_bookings(self, request, queryset):
        # Route through the service so declining also relists the property (when
        # nothing else holds it) and notifies the guest.
        from .services import process_booking_decline
        eligible = queryset.exclude(status__in=['confirmed', 'completed', 'declined', 'cancelled'])
        count = 0
        for booking in eligible:
            process_booking_decline(booking)
            count += 1
        self.message_user(request, f'{count} booking(s) declined and relisted where applicable.', messages.WARNING)

    fieldsets = (
        ('Booking Details', {
            'fields': ('listing', 'customer', 'start_date', 'end_date', 'total_price')
        }),
        ('Status & Notes', {
            'fields': ('status', 'notes', 'owner_notes', 'decline_reason')
        }),
        ('Timestamps', {
            'fields': ('requested_at', 'confirmed_at', 'declined_at'),
            'classes': ('collapse',)
        }),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        return qs.filter(
            models.Q(customer=request.user) |
            models.Q(listing__owner=request.user)
        ).distinct()

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "listing" and not request.user.is_superuser:
            kwargs["queryset"] = db_field.related_model.objects.filter(owner=request.user)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(ViewingAppointment)
class ViewingAppointmentAdmin(admin.ModelAdmin):
    list_display = ['listing', 'guest_full_name', 'viewing_date', 'viewing_time_range', 'status', 'is_fee_paid', 'scheduled_at', 'created_at']

    @admin.display(description='Time')
    def viewing_time_range(self, obj):
        return obj.viewing_time_range or '—'
    list_filter = ['status', 'is_fee_paid', 'viewing_date']
    search_fields = [
        'listing__title', 'guest__username', 'guest__first_name',
        'guest__last_name', 'guest__email',
    ]
    readonly_fields = ['created_at', 'updated_at', 'fee_paid_at', 'booking']
    raw_id_fields = ['listing', 'guest', 'confirmed_by']
    date_hierarchy = 'viewing_date'
    actions = ['mark_scheduled', 'mark_completed']

    @admin.display(description='Guest', ordering='guest__last_name')
    def guest_full_name(self, obj):
        return obj.guest.get_full_name() or obj.guest.username

    @admin.action(description='Mark selected viewings as scheduled')
    def mark_scheduled(self, request, queryset):
        updated = queryset.filter(status='fee_paid').update(
            status='scheduled', scheduled_at=timezone.now(), confirmed_by=request.user,
        )
        self.message_user(request, f'{updated} viewing(s) scheduled.', messages.SUCCESS)

    @admin.action(description='Mark selected viewings as completed')
    def mark_completed(self, request, queryset):
        updated = queryset.filter(status='scheduled').update(status='completed')
        self.message_user(request, f'{updated} viewing(s) marked completed.', messages.SUCCESS)


@admin.register(PaymentRequest)
class PaymentRequestAdmin(admin.ModelAdmin):
    list_display = ['booking', 'amount', 'currency', 'is_paid', 'created_by', 'created_at']
    list_filter = ['is_paid', 'currency']
    search_fields = ['booking__listing__title', 'booking__customer__username', 'booking__customer__email']
    readonly_fields = ['created_at', 'paid_at']
