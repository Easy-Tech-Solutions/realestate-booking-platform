from django.db import migrations


def add_resort_category(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    PropertyCategory.objects.update_or_create(
        slug='resort',
        defaults={
            'name': 'Resort',
            'is_active': True,
            'sort_order': 12,
        },
    )


def remove_resort_category(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    PropertyCategory.objects.filter(slug='resort').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0025_merge_20260904_2240'),
    ]

    operations = [
        migrations.RunPython(add_resort_category, remove_resort_category),
    ]
