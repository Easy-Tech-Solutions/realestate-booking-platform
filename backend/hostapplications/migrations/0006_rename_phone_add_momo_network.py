from django.db import migrations, models


class Migration(migrations.Migration):
    """Rename HostApplication.phone → momo_number (the host's payout number) and
    add momo_network. RenameField preserves the column data; the subsequent
    users backfill (0019) overwrites approved applications' momo_number with the
    host's real registered payout number from their profile."""

    dependencies = [
        ('hostapplications', '0005_hostapplication_next_of_kin_name_and_more'),
    ]

    operations = [
        migrations.RenameField(
            model_name='hostapplication',
            old_name='phone',
            new_name='momo_number',
        ),
        migrations.AddField(
            model_name='hostapplication',
            name='momo_network',
            field=models.CharField(
                choices=[('mtn', 'MTN Mobile Money'), ('orange', 'Orange Money')],
                default='mtn',
                max_length=10,
            ),
        ),
    ]
