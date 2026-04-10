from django.contrib import admin
from .models import Listing, ListingImage, Favorite

class ListingImageInline(admin.TabularInline):
    model = ListingImage
    extra = 3
    fields = ['image', 'caption', 'order']
    ordering = ['order']

@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ['title', 'price', 'property_type', 'bedrooms', 'owner', 'is_available', 'created_at']
    list_filter = ['property_type', 'is_available', 'created_at', 'owner']
    search_fields = ['title', 'description', 'address']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [ListingImageInline]
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('title', 'description', 'owner')
        }),
        ('Property Details', {
            'fields': ('property_type', 'bedrooms', 'square_footage', 'address')
        }),
        ('Pricing & Availability', {
            'fields': ('price', 'is_available')
        }),
        ('Images', {
            'fields': ('main_image',)
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
        # Non-superusers can only see their own listings
        return qs.filter(owner=request.user)

@admin.register(ListingImage)
class ListingImageAdmin(admin.ModelAdmin):
    list_display = ['listing', 'caption', 'order', 'created_at']
    list_filter = ['created_at', 'listing']
    search_fields = ['listing__title', 'caption']
    ordering = ['listing', 'order']

@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ['user', 'listing','created_at']
    list_filter = ['created_at', 'listing__property_type']
    search_fields = ['user__username', 'listing__title']
    readonly_fields = ['created_at']

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        return qs.filter(user=request.user) 