from django.contrib import admin
from .models import BlacklistedToken, SocialAccount

@admin.register(BlacklistedToken)
class BlacklistedTokenAdmin(admin.ModelAdmin):
    list_display = ['token', 'blacklisted_at']
    readonly_fields = ['token', 'blacklisted_at']
    search_fields = ['token']


@admin.register(SocialAccount)
class SocialAccountAdmin(admin.ModelAdmin):
    list_display = ['user', 'provider', 'email_at_link', 'created_at', 'last_login_at']
    list_filter = ['provider']
    search_fields = ['user__username', 'user__email', 'email_at_link', 'provider_user_id']
    readonly_fields = ['provider_user_id', 'created_at', 'last_login_at']
    raw_id_fields = ['user']