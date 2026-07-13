from django.db import migrations

# The one account that keeps the new top tier (unrestricted, is_superuser
# bypass) — everyone else currently holding the old, single 'admin' role
# drops to the new, lesser 'admin' tier (RBAC-governed via the 'Admin'
# preset role, no more automatic superuser bypass).
SUPERADMIN_EMAIL = 'dalton.edu02@gmail.com'


def promote_and_demote(apps, schema_editor):
    User = apps.get_model('users', 'User')
    Role = apps.get_model('rbac', 'Role')
    UserRoleAssignment = apps.get_model('rbac', 'UserRoleAssignment')

    admin_role = Role.objects.filter(slug='admin').first()

    for user in User.objects.filter(role='admin'):
        if user.email.lower() == SUPERADMIN_EMAIL:
            user.role = 'superadmin'
            user.is_staff = True
            user.is_superuser = True
            user.save(update_fields=['role', 'is_staff', 'is_superuser'])
        else:
            user.role = 'admin'
            user.is_superuser = False
            user.is_staff = True
            user.save(update_fields=['role', 'is_superuser', 'is_staff'])
            if admin_role and user.is_active:
                UserRoleAssignment.objects.get_or_create(user=user, role=admin_role)


def reverse(apps, schema_editor):
    # Not meaningfully reversible — we don't know who was is_superuser
    # before this ran. No-op reverse is intentional.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0016_alter_user_role'),
        ('rbac', '0003_seed_admin_superadmin_presets'),
    ]

    operations = [
        migrations.RunPython(promote_and_demote, reverse),
    ]
