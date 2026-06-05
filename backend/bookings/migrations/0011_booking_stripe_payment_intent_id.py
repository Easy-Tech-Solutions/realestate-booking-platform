from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0010_partial_unique_booking'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='stripe_payment_intent_id',
            field=models.CharField(blank=True, max_length=100, null=True, unique=True),
        ),
    ]
