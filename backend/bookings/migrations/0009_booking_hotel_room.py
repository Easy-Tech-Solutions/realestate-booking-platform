from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0008_booking_total_price'),
        ('listings', '0012_hotelroom'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='hotel_room',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='bookings',
                to='listings.hotelroom',
            ),
        ),
    ]
