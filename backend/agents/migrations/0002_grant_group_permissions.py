from django.db import migrations


GROUPS = [
    ('Product Support Officers', 'review_agent_product_support'),
    ('Compliance Officers',      'review_agent_compliance'),
    ('Supervisors',              'review_agent_supervisor'),
]

REVIEW_PERMISSIONS = {
    'review_agent_product_support': 'Can review agent applications at the Product Support stage',
    'review_agent_compliance':      'Can review agent applications at the Compliance stage',
    'review_agent_supervisor':      'Can review agent applications at the Supervisor stage',
}


def grant(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    ct, _ = ContentType.objects.get_or_create(app_label='agents', model='agentapplication')

    def perm(codename, name):
        p, _ = Permission.objects.get_or_create(codename=codename, content_type=ct, defaults={'name': name})
        return p

    view   = perm('view_agentapplication',   'Can view agent application')
    change = perm('change_agentapplication', 'Can change agent application')

    for group_name, review_codename in GROUPS:
        review = perm(review_codename, REVIEW_PERMISSIONS[review_codename])
        group = Group.objects.filter(name=group_name).first()
        if group:
            group.permissions.add(view, change, review)


def revoke(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    ct = ContentType.objects.filter(app_label='agents', model='agentapplication').first()
    if not ct:
        return
    perms = Permission.objects.filter(content_type=ct)
    for group_name, _ in GROUPS:
        group = Group.objects.filter(name=group_name).first()
        if group:
            group.permissions.remove(*perms)


class Migration(migrations.Migration):

    dependencies = [
        ('agents', '0001_initial'),
        ('hostapplications', '0002_create_reviewer_groups'),
        ('auth', '__first__'),
        ('contenttypes', '__first__'),
    ]

    operations = [migrations.RunPython(grant, revoke)]
