from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0009_booking_hotel_room'),
    ]

    operations = [
        # Drop the blanket unique constraint that blocked re-booking the
        # same property/dates after a decline or cancellation.
        migrations.AlterUniqueTogether(
            name='booking',
            unique_together=set(),
        ),
        # Re-introduce uniqueness, but only for bookings in an active state.
        migrations.AddConstraint(
            model_name='booking',
            constraint=models.UniqueConstraint(
                fields=['customer', 'listing', 'start_date', 'end_date'],
                condition=models.Q(
                    status__in=['requested', 'pending', 'confirmed']
                ),
                name='unique_active_booking_per_guest_listing_dates',
            ),
        ),
    ]
