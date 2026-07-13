"""
Preset roles backing the legacy department system (superadmin.constants.
DEPARTMENTS). Each slug here matches a department slug exactly, so
`rbac.permissions.has_role(user, department_slug)` is a drop-in replacement
for the old "is this user in the Django Group named `department_slug`?"
check — see superadmin/permissions.py:require_department().

At the time this was introduced, zero real users held any department Group
membership (verified directly against production), so there was nothing to
migrate — these presets simply give the *new* engine equivalent reach to
what each department could already do, ready for staff to be assigned to
going forward via UserRoleAssignment instead of Django Groups.
"""

PRESET_ROLE_DEFINITIONS = {
    'trust_safety': {
        'name': 'Trust & Safety Specialist',
        'description': (
            'Fraud/AML review, device & location bans, account suspensions, '
            'and identity verification. Backs the legacy trust_safety department.'
        ),
        'full_resources': ['trust_safety', 'users.behavior_logs'],
        'read_only_resources': ['users.pii'],
    },
    'inventory': {
        'name': 'Inventory & Listings Moderator',
        'description': 'Listing moderation queue — suspend/restore listings, review flags. Backs the legacy inventory department.',
        'full_resources': ['listings'],
        'read_only_resources': [],
    },
    'support': {
        'name': 'Customer Support Representative',
        'description': (
            'Support ticket queue, user reports, refund vouchers, and suspensions '
            'arising from disputes. Backs the legacy support department.'
        ),
        'full_resources': ['customer_support', 'trust_safety.bans'],
        'read_only_resources': ['reservations.communications'],
    },
    'finance': {
        'name': 'Financial Operations Auditor',
        'description': (
            'Host payouts, refunds, platform fee configuration, and legal document '
            'versioning. Backs the legacy finance department.'
        ),
        'full_resources': ['finances'],
        'read_only_resources': [],
    },
    'engineering': {
        'name': 'Product & Systems Engineer',
        'description': 'Feature flags, system health, and cache management. Backs the legacy engineering department.',
        'full_resources': ['infrastructure'],
        'read_only_resources': [],
    },
    'admin': {
        'name': 'Admin',
        'description': (
            'Broad operational access to every part of the platform — users, listings, '
            'bookings, finance, trust & safety, support, and marketing. Second tier to '
            'Superadmin: cannot manage roles/permissions (rbac_engine) or request '
            'break-glass elevation, so an Admin can never self-escalate. Users with the '
            "app-level 'admin' role are automatically assigned this Role."
        ),
        'full_resources': [
            'users', 'listings', 'reservations', 'finances', 'trust_safety', 'customer_support',
            'infrastructure.feature_flags', 'infrastructure.system_caches', 'marketing', 'audit_log',
        ],
        'read_only_resources': [],
    },
    'superadmin': {
        'name': 'Superadmin',
        'description': (
            "Unrestricted access to everything, including role/permission management and "
            "break-glass elevation. Real superadmin status comes from the account's "
            "role field (role='superadmin' or is_superuser=True), which bypasses this "
            'engine entirely (see rbac.permissions.is_full_admin) — this preset exists so '
            "the full permission set is visible here for documentation, not because it's "
            'required for access.'
        ),
        'full_resources': [
            'users', 'listings', 'reservations', 'finances', 'trust_safety', 'customer_support',
            'infrastructure', 'marketing', 'rbac_engine', 'audit_log',
        ],
        'read_only_resources': [],
    },
}


def seed_preset_roles():
    from .models import Role, RolePermission
    from .resources import ACTIONS

    for slug, definition in PRESET_ROLE_DEFINITIONS.items():
        role, _ = Role.objects.get_or_create(
            slug=slug,
            defaults={'name': definition['name'], 'description': definition['description'], 'is_preset': True},
        )
        if role.name != definition['name'] or role.description != definition['description'] or not role.is_preset:
            role.name = definition['name']
            role.description = definition['description']
            role.is_preset = True
            role.save(update_fields=['name', 'description', 'is_preset'])

        for resource in definition['full_resources']:
            for action in ACTIONS:
                RolePermission.objects.get_or_create(role=role, resource=resource, action=action)
        for resource in definition['read_only_resources']:
            RolePermission.objects.get_or_create(role=role, resource=resource, action='read')
