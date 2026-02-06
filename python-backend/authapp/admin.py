from django.contrib import admin
from .models import BlacklistedToken

@admin.register(BlacklistedToken)
class BlacklistedTokenAdmin(admin.ModelAdmin):
    list_display = ['token', 'created_at']
    readonly_fields = ['token', 'created_at']
    search_fields = ['token']