from django.db import migrations


# (group name, custom review permission codename for that stage)
GROUPS = [
    ('Product Support Officers', 'review_product_support'),
    ('Compliance Officers',      'review_compliance'),
    ('Supervisors',              'review_supervisor'),
]

REVIEW_PERMISSIONS = {
    'review_product_support': 'Can review host applications at the Product Support stage',
    'review_compliance':      'Can review host applications at the Compliance stage',
    'review_supervisor':      'Can review host applications at the Supervisor stage',
}


def create_groups(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    ct, _ = ContentType.objects.get_or_create(
        app_label='hostapplications', model='hostapplication',
    )

    def perm(codename, name):
        # Model permissions are normally created by a post_migrate signal that
        # runs only after the whole migrate completes, so they may not exist yet
        # when this data migration runs. get_or_create makes it order-safe.
        p, _ = Permission.objects.get_or_create(
            codename=codename, content_type=ct, defaults={'name': name},
        )
        return p

    view   = perm('view_hostapplication',   'Can view host application')
    change = perm('change_hostapplication', 'Can change host application')

    for group_name, review_codename in GROUPS:
        review = perm(review_codename, REVIEW_PERMISSIONS[review_codename])
        group, _ = Group.objects.get_or_create(name=group_name)
        group.permissions.add(view, change, review)


def remove_groups(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.filter(name__in=[name for name, _ in GROUPS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('hostapplications', '0001_initial'),
        ('auth', '__first__'),
        ('contenttypes', '__first__'),
    ]

    operations = [
        migrations.RunPython(create_groups, remove_groups),
    ]
