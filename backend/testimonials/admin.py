from django.contrib import admin
from .models import Testimonial


@admin.register(Testimonial)
class TestimonialAdmin(admin.ModelAdmin):
    list_display = ['name', 'location', 'rating', 'is_active', 'created_at']
    list_filter = ['is_active', 'rating']
    search_fields = ['name', 'location', 'quote']
    list_editable = ['is_active']
