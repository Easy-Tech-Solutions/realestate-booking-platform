from django.contrib import admin

from .models import AccountSignupEvent, BlacklistedLocation, BlockedFingerprint, FraudFlag


@admin.register(FraudFlag)
class FraudFlagAdmin(admin.ModelAdmin):
    list_display = ['id', 'flag_type', 'severity', 'status', 'user', 'created_at']
    list_filter = ['flag_type', 'severity', 'status']
    search_fields = ['user__username', 'user__email', 'details']


@admin.register(BlockedFingerprint)
class BlockedFingerprintAdmin(admin.ModelAdmin):
    list_display = ['fingerprint', 'reason', 'blocked_by', 'created_at']
    search_fields = ['fingerprint', 'reason']


@admin.register(BlacklistedLocation)
class BlacklistedLocationAdmin(admin.ModelAdmin):
    list_display = ['name', 'latitude', 'longitude', 'radius_km', 'created_by', 'created_at']
    search_fields = ['name', 'reason']


@admin.register(AccountSignupEvent)
class AccountSignupEventAdmin(admin.ModelAdmin):
    list_display = ['user', 'ip_address', 'created_at']
    search_fields = ['user__username', 'ip_address']
    readonly_fields = ['user', 'ip_address', 'created_at']

    def has_add_permission(self, request):
        return False
