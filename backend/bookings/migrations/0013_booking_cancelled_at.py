from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0012_booking_statuses_paymentrequest'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='cancelled_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
