from django.conf import settings
from django.db import models


class AdminAuditLog(models.Model):
    """
    Immutable record of every sensitive action taken from the superadmin
    dashboard: who, what, on what, why, and from where. Never edited or
    deleted through the API — only ever appended to.
    """
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name='admin_audit_actions',
    )
    action = models.CharField(max_length=100, db_index=True, help_text="e.g. 'user.suspend', 'listing.remove', 'impersonation.start'")
    target_type = models.CharField(max_length=50, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True, db_index=True)
    target_repr = models.CharField(max_length=255, blank=True, help_text="Human-readable snapshot of the target at the time of the action")
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        actor_label = self.actor.username if self.actor_id else 'deleted-user'
        return f'{actor_label} {self.action} {self.target_type}:{self.target_id}'


class MFADevice(models.Model):
    """One TOTP authenticator per user. Originally built for admin/staff
    accounts (see superadmin.views.mfa_setup/mfa_confirm) but usable by any
    account — the login step-up in authapp.views.login_view checks for a
    confirmed device on any user, not just staff. users.views exposes a
    parallel self-service setup/confirm/disable flow for regular accounts."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mfa_device')
    secret = models.CharField(max_length=64)
    confirmed = models.BooleanField(default=False)
    backup_codes = models.JSONField(default=list, blank=True, help_text="Hashed one-time backup codes")
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'MFA device for {self.user.username} ({"confirmed" if self.confirmed else "pending"})'

    def verify_code_or_backup(self, code: str) -> bool:
        """Check a TOTP code, falling back to (and consuming) a one-time
        backup code. Shared by both the superadmin and regular-user MFA
        endpoints so the verification logic lives in exactly one place."""
        import pyotp
        from django.contrib.auth.hashers import check_password

        if pyotp.TOTP(self.secret).verify(code, valid_window=1):
            return True
        for hashed in self.backup_codes:
            if check_password(code, hashed):
                self.backup_codes = [h for h in self.backup_codes if h != hashed]
                self.save(update_fields=['backup_codes'])
                return True
        return False


class ImpersonationSession(models.Model):
    """Tracks every 'view as user' session for audit purposes."""
    admin = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='impersonations_started',
    )
    target = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='impersonated_by_sessions',
    )
    reason = models.TextField(blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        status = 'active' if self.ended_at is None else 'ended'
        return f'{self.admin.username} as {self.target.username} ({status})'
