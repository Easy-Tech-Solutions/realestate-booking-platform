from django.db import migrations


def seed(apps, schema_editor):
    from rbac.preset_roles import seed_preset_roles
    seed_preset_roles()


def unseed(apps, schema_editor):
    Role = apps.get_model('rbac', 'Role')
    Role.objects.filter(is_preset=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
