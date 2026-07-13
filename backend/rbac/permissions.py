from django.utils import timezone

from .resources import ACTIONS, ancestors_of, is_valid_resource


def is_full_admin(user):
    """Only the top tier — 'superadmin' (or Django is_superuser) — bypasses
    every permission check unconditionally. The lesser 'admin' tier is
    intentionally NOT included here: its abilities come entirely from the
    RBAC engine's 'Admin' preset role, not an automatic bypass."""
    return bool(user and user.is_authenticated and (user.role == 'superadmin' or user.is_superuser))


def has_active_break_glass(user):
    from .models import BreakGlassSession
    if not (user and user.is_authenticated):
        return False
    return BreakGlassSession.objects.filter(
        user=user, revoked_at__isnull=True, expires_at__gt=timezone.now(),
    ).exists()


def user_roles(user):
    from .models import Role
    if not (user and user.is_authenticated):
        return Role.objects.none()
    return Role.objects.filter(assignments__user=user)


def has_role(user, role_slug):
    """True if the user holds the named role (directly, or implicitly via
    full-admin/break-glass status). This is what the legacy
    superadmin.permissions.require_department() now delegates to — every
    existing department-gated endpoint keeps working unchanged."""
    if is_full_admin(user) or has_active_break_glass(user):
        return True
    return user_roles(user).filter(slug=role_slug).exists()


def has_permission(user, resource, action):
    """The core check: does `user` hold ANY assigned role granting `action`
    on `resource` or one of its ancestors (a grant on a parent node implies
    every descendant)? Full admins and active break-glass sessions always
    pass, matching Tier 5 / the break-glass protocol."""
    if not is_valid_resource(resource) or action not in ACTIONS:
        return False
    if is_full_admin(user) or has_active_break_glass(user):
        return True
    if not (user and user.is_authenticated):
        return False

    from .models import RolePermission
    candidate_paths = ancestors_of(resource)
    return RolePermission.objects.filter(
        role__assignments__user=user,
        resource__in=candidate_paths,
        action=action,
    ).exists()


def has_any_permission(user, resource):
    """True if the user holds ANY action at all on `resource` or one of its
    ancestors — used by legacy per-app gate functions (e.g. "does this user
    have trust_safety access at all") that don't distinguish action
    granularity within themselves. A custom role built with the intent of
    granting a resource naturally includes at least one action on it, so
    this is the right signal for a coarse all-or-nothing gate."""
    if not is_valid_resource(resource):
        return False
    if is_full_admin(user) or has_active_break_glass(user):
        return True
    if not (user and user.is_authenticated):
        return False

    from .models import RolePermission
    candidate_paths = ancestors_of(resource)
    return RolePermission.objects.filter(role__assignments__user=user, resource__in=candidate_paths).exists()


def effective_grants(user):
    """Every (resource, action) pair this user currently holds, resolved
    through all their roles — used by the frontend to render 'what can I
    do' without re-deriving it client-side."""
    if is_full_admin(user):
        from .resources import RESOURCE_TREE
        return {(path, action) for path, *_ in RESOURCE_TREE for action in ACTIONS}
    from .models import RolePermission
    rows = RolePermission.objects.filter(role__assignments__user=user).values_list('resource', 'action')
    return set(rows)
