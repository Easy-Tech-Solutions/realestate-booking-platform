from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0016_listing_deleted_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='listing',
            name='pricing_type',
            field=models.CharField(
                choices=[('nightly', 'Per Night'), ('monthly', 'Per Month')],
                default='nightly',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='listing',
            name='payment_schedule',
            field=models.CharField(
                blank=True,
                choices=[
                    ('monthly', 'Monthly'),
                    ('quarterly', 'Every 3 Months'),
                    ('biannual', 'Every 6 Months'),
                    ('annual', 'Annual'),
                ],
                help_text='Required for monthly-priced listings (room, apartment, house)',
                max_length=15,
                null=True,
            ),
        ),
    ]
