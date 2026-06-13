from django.db import migrations


def add_new_categories(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')

    new_categories = [
        ('Single Room', 'room', 9),
        ('Air BnB', 'airbnb', 10),
        ('Whole House', 'house', 11),
    ]

    for name, slug, sort_order in new_categories:
        PropertyCategory.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'is_active': True,
                'sort_order': sort_order,
            },
        )


def remove_new_categories(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    PropertyCategory.objects.filter(slug__in=['room', 'airbnb', 'house']).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0016_listing_pricing_type_payment_schedule'),
    ]

    operations = [
        migrations.RunPython(add_new_categories, remove_new_categories),
    ]
