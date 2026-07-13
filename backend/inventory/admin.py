from django.contrib import admin

from .models import ListingFlag


@admin.register(ListingFlag)
class ListingFlagAdmin(admin.ModelAdmin):
    list_display = ['id', 'flag_type', 'severity', 'status', 'listing', 'created_at']
    list_filter = ['flag_type', 'severity', 'status']
    search_fields = ['listing__title', 'listing__address', 'details']
