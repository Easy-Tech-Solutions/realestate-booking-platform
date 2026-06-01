from django.contrib import admin
from django.db import models
from .models import Booking

@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ['listing', 'customer_full_name', 'start_date', 'end_date', 'status', 'requested_at']
    list_filter = ['status', 'requested_at', 'start_date', 'listing', 'customer']
    search_fields = [
        'listing__title',
        'customer__username',
        'customer__first_name',
        'customer__last_name',
        'customer__email',
        'notes',
    ]
    readonly_fields = ['requested_at', 'confirmed_at']

    @admin.display(description='Customer', ordering='customer__last_name')
    def customer_full_name(self, obj):
        return obj.customer.get_full_name() or obj.customer.username
    
    fieldsets = (
        ('Booking Details', {
            'fields': ('listing', 'customer', 'start_date', 'end_date')
        }),
        ('Status & Notes', {
            'fields': ('status', 'notes')
        }),
        ('Timestamps', {
            'fields': ('requested_at', 'confirmed_at'),
            'classes': ('collapse',)
        }),
    )
    
    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        # Non-superusers can only see their own bookings (as customer) or bookings for their listings (as owner)
        return qs.filter(
            models.Q(customer=request.user) | 
            models.Q(listing__owner=request.user)
        ).distinct()
    
    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        # Filter listings to show only user's own listings (unless superuser)
        if db_field.name == "listing" and not request.user.is_superuser:
            kwargs["queryset"] = db_field.related_model.objects.filter(owner=request.user)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)
