from rest_framework.permissions import BasePermission

from .constants import DEPARTMENT_SLUGS
from .models import AdminAuditLog


def get_client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def is_full_admin(user):
    """A full admin (app-level role='superadmin') always passes every
    department check — see users.models.User.save, which forces
    is_staff/is_superuser for this role. The lesser 'admin' tier does NOT
    get this automatic bypass — its access comes entirely from the RBAC
    engine's 'Admin' preset role."""
    return bool(user and user.is_authenticated and (user.role == 'superadmin' or user.is_superuser))


def is_superadmin_staff(user):
    """Anyone allowed into /superadmin at all: full admins, or is_staff
    accounts scoped to specific departments."""
    return bool(user and user.is_authenticated and (is_full_admin(user) or user.is_staff))


def user_departments(user):
    """Department slugs this user can see. Full admins see all of them.

    Delegates to the rbac app's role engine — each department slug is backed
    by a preset Role of the same slug (see rbac.preset_roles). This used to
    check Django Group membership directly; at the time of the switch zero
    real users held any department Group, so there was nothing to migrate."""
    if is_full_admin(user):
        return list(DEPARTMENT_SLUGS)
    if not user or not user.is_authenticated:
        return []
    from rbac.permissions import has_role
    return [slug for slug in DEPARTMENT_SLUGS if has_role(user, slug)]


def log_admin_action(request, action, target=None, reason='', **metadata):
    """Append an audit log entry. `target` is any model instance with a pk —
    its type/id/str() are captured automatically."""
    target_type = target.__class__.__name__.lower() if target is not None else ''
    target_id = str(target.pk) if target is not None else ''
    target_repr = str(target) if target is not None else ''
    AdminAuditLog.objects.create(
        actor=request.user if request.user.is_authenticated else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_repr=target_repr[:255],
        reason=reason or '',
        ip_address=get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
        metadata=metadata,
    )


class IsSuperadminStaff(BasePermission):
    """Base gate for every /api/superadmin/ endpoint: full admins, or
    is_staff accounts (further scoped per-view by department)."""
    message = 'Superadmin access required.'

    def has_permission(self, request, view):
        return is_superadmin_staff(request.user)


def require_department(user, department):
    """True if `user` may access the given department's module."""
    return department in user_departments(user)
