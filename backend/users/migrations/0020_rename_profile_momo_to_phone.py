from django.db import migrations, models


class Migration(migrations.Migration):
    """Rename Profile.momo_number → phone_number (now a contact-only number).
    Runs AFTER 0019 has copied the payout numbers onto the host applications."""

    dependencies = [
        ('users', '0019_backfill_host_momo_from_profile'),
    ]

    operations = [
        migrations.RenameField(
            model_name='profile',
            old_name='momo_number',
            new_name='phone_number',
        ),
        migrations.AlterField(
            model_name='profile',
            name='phone_number',
            field=models.CharField(
                blank=True,
                help_text='Contact phone number (NOT used for payouts — that is '
                          'the host application MoMo number). Liberian format, e.g. 0880123456.',
                max_length=20,
            ),
        ),
    ]
