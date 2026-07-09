from django.db import migrations


# (existing group name, custom review permission codename for that stage)
GROUPS = [
    ('Product Support Officers', 'review_property_product_support'),
    ('Compliance Officers',      'review_property_compliance'),
    ('Supervisors',              'review_property_supervisor'),
]

REVIEW_PERMISSIONS = {
    'review_property_product_support': 'Can review property verifications at the Product Support stage',
    'review_property_compliance':      'Can review property verifications at the Compliance stage',
    'review_property_supervisor':      'Can review property verifications at the Supervisor stage',
}


def grant(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    ct, _ = ContentType.objects.get_or_create(
        app_label='propertyverifications', model='propertyverification',
    )

    def perm(codename, name):
        # Model permissions are created by a post_migrate signal that hasn't run
        # yet during this data migration, so get_or_create keeps it order-safe.
        p, _ = Permission.objects.get_or_create(
            codename=codename, content_type=ct, defaults={'name': name},
        )
        return p

    view   = perm('view_propertyverification',   'Can view property verification')
    change = perm('change_propertyverification', 'Can change property verification')

    for group_name, review_codename in GROUPS:
        review = perm(review_codename, REVIEW_PERMISSIONS[review_codename])
        group = Group.objects.filter(name=group_name).first()
        if group:  # groups are created by hostapplications' data migration
            group.permissions.add(view, change, review)


def revoke(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    ct = ContentType.objects.filter(app_label='propertyverifications', model='propertyverification').first()
    if not ct:
        return
    perms = Permission.objects.filter(content_type=ct)
    for group_name, _ in GROUPS:
        group = Group.objects.filter(name=group_name).first()
        if group:
            group.permissions.remove(*perms)


class Migration(migrations.Migration):

    dependencies = [
        ('propertyverifications', '0001_initial'),
        ('hostapplications', '0002_create_reviewer_groups'),
        ('auth', '__first__'),
        ('contenttypes', '__first__'),
    ]

    operations = [
        migrations.RunPython(grant, revoke),
    ]
