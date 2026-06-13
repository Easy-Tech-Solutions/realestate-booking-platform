from django.contrib import admin
from django.db import models
from django.utils import timezone
from django.contrib import messages
from .models import Booking, PaymentRequest


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

    @admin.display(description='Customer', ordering='customer__last_name')
    def customer_full_name(self, obj):
        return obj.customer.get_full_name() or obj.customer.username

    @admin.action(description='Confirm selected bookings (payment received)')
    def confirm_bookings(self, request, queryset):
        updated = queryset.filter(status='payment_received').update(
            status='confirmed',
            confirmed_at=timezone.now(),
        )
        self.message_user(request, f'{updated} booking(s) confirmed.', messages.SUCCESS)

    @admin.action(description='Decline selected bookings')
    def decline_bookings(self, request, queryset):
        updated = queryset.exclude(status__in=['confirmed', 'completed']).update(
            status='declined',
            declined_at=timezone.now(),
        )
        self.message_user(request, f'{updated} booking(s) declined.', messages.WARNING)

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


@admin.register(PaymentRequest)
class PaymentRequestAdmin(admin.ModelAdmin):
    list_display = ['booking', 'amount', 'currency', 'is_paid', 'created_by', 'created_at']
    list_filter = ['is_paid', 'currency']
    search_fields = ['booking__listing__title', 'booking__customer__username', 'booking__customer__email']
    readonly_fields = ['created_at', 'paid_at']
