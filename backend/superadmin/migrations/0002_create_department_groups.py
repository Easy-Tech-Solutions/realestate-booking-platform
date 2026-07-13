from django.db import migrations


def create_department_groups(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    # Local import is safe here: constants.py has no Django-app-loading side
    # effects, just a plain list.
    from superadmin.constants import DEPARTMENT_SLUGS
    for slug in DEPARTMENT_SLUGS:
        Group.objects.get_or_create(name=slug)


def remove_department_groups(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    from superadmin.constants import DEPARTMENT_SLUGS
    Group.objects.filter(name__in=DEPARTMENT_SLUGS).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('superadmin', '0001_initial'),
        ('auth', '__first__'),
    ]

    operations = [
        migrations.RunPython(create_department_groups, remove_department_groups),
    ]
