from django.db import migrations


def seed(apps, schema_editor):
    from rbac.preset_roles import seed_preset_roles
    seed_preset_roles()


def unseed(apps, schema_editor):
    Role = apps.get_model('rbac', 'Role')
    Role.objects.filter(slug__in=['admin', 'superadmin']).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0002_seed_preset_roles'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
