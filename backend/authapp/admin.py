from django.contrib import admin
from .models import BlacklistedToken

@admin.register(BlacklistedToken)
class BlacklistedTokenAdmin(admin.ModelAdmin):
    list_display = ['token', 'blacklisted_at']
    readonly_fields = ['token', 'blacklisted_at']
    search_fields = ['token']