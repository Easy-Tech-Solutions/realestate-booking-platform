from django.contrib import admin
from django.db import models
from .models import Booking

@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ['listing', 'customer', 'start_date', 'end_date', 'status', 'created_at']
    list_filter = ['status', 'created_at', 'start_date', 'listing', 'customer']
    search_fields = ['listing__title', 'customer__username', 'notes']
    readonly_fields = ['created_at', 'updated_at']
    
    fieldsets = (
        ('Booking Details', {
            'fields': ('listing', 'customer', 'start_date', 'end_date')
        }),
        ('Status & Notes', {
            'fields': ('status', 'notes')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
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
