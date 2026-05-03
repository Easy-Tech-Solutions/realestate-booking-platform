from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0007_alter_savedsearch_property_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='total_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
    ]
