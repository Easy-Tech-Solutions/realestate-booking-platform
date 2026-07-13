from django.conf import settings
from django.db import models
from django.utils import timezone


class Role(models.Model):
    """A named bundle of (resource, action) grants. `is_preset` marks the 5
    roles auto-created to back the legacy department system (see
    rbac/preset_roles.py) — they can still be edited like any other role,
    but deleting them would silently break existing staff access, so the
    admin UI should warn loudly before allowing that."""

    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    is_preset = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='roles_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class RolePermission(models.Model):
    """One (resource, action) grant belonging to a Role. `resource` is a dot
    path from rbac.resources.RESOURCE_TREE — may be a parent node, which
    implies every descendant (see rbac.permissions.has_permission)."""

    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='permissions')
    resource = models.CharField(max_length=100)
    action = models.CharField(max_length=20)

    class Meta:
        unique_together = ('role', 'resource', 'action')

    def __str__(self):
        return f'{self.role.slug}: {self.resource}.{self.action}'


class UserRoleAssignment(models.Model):
    """A user holding a role. Users may hold multiple roles simultaneously —
    effective permissions are the union of every assigned role's grants."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='role_assignments')
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='assignments')
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='role_assignments_granted',
    )
    granted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'role')

    def __str__(self):
        return f'{self.user.username} — {self.role.slug}'


class BreakGlassSession(models.Model):
    """Temporary full-access elevation for engineers during an incident.
    While active, has_permission() treats the user as a full admin. Every
    request made during the window is logged to AdminAuditLog by
    rbac.middleware.BreakGlassAuditMiddleware — a complete request-level
    trail (method, path, status, timing), not literal keystroke capture,
    which isn't achievable server-side without client-side instrumentation
    this project doesn't have."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='break_glass_sessions')
    reason = models.TextField()
    granted_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='break_glass_sessions_revoked',
    )

    class Meta:
        ordering = ['-granted_at']

    def __str__(self):
        return f'{self.user.username} — break-glass until {self.expires_at}'

    @property
    def is_active(self):
        if self.revoked_at is not None:
            return False
        return timezone.now() < self.expires_at


class PendingApproval(models.Model):
    """A dual-authorization request: an action whose execution is deferred
    until a *different* admin approves it. `action_key` maps to an executor
    function in rbac.dual_auth.EXECUTORS; `payload` holds whatever that
    executor needs (e.g. {'payment_id': ..., 'amount': ..., 'reason': ...})."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    action_key = models.CharField(max_length=60)
    payload = models.JSONField(default=dict)
    request_reason = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='pending_approvals_requested',
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pending_approvals_decided',
    )
    decision_reason = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    execution_result = models.JSONField(null=True, blank=True)
    execution_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.action_key} requested by {self.requested_by.username} ({self.status})'
