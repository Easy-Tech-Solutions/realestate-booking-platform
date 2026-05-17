from django.db import migrations, models


def rename_homes_to_apartment(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    Listing = apps.get_model('listings', 'Listing')

    PropertyCategory.objects.filter(slug='homes').update(name='Apartment', slug='apartment')
    Listing.objects.filter(property_type='homes').update(property_type='apartment')


def reverse_apartment_to_homes(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    Listing = apps.get_model('listings', 'Listing')

    PropertyCategory.objects.filter(slug='apartment').update(name='Homes', slug='homes')
    Listing.objects.filter(property_type='apartment').update(property_type='homes')


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0010_add_location_checkin_selfcheckin_fields'),
    ]

    operations = [
        migrations.RunPython(rename_homes_to_apartment, reverse_apartment_to_homes),
        migrations.AlterField(
            model_name='listing',
            name='property_type',
            field=models.CharField(default='apartment', max_length=50),
        ),
    ]
