# Department groups used for RBAC within the superadmin dashboard. These map
# 1:1 onto Django's built-in auth Groups (managed via /admin/ -> Groups) so no
# custom role-assignment UI is needed. A user with the app-level 'superadmin'
# role is always a full admin (see users.models.User.save) and bypasses
# department scoping entirely; everyone else (including the lesser 'admin'
# tier) needs an is_staff account plus membership in the relevant group(s)
# below, or the equivalent RBAC role grant, to see that module of /management.
DEPARTMENTS = [
    ('trust_safety', 'Trust & Safety'),
    ('inventory', 'Inventory & Listings'),
    ('support', 'Dispute Resolution & Support'),
    ('finance', 'Finance & Legal'),
    ('engineering', 'Platform & Engineering'),
]
DEPARTMENT_SLUGS = [slug for slug, _ in DEPARTMENTS]
