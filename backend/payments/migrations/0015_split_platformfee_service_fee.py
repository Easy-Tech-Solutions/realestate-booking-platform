from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    """Split the single `service_fee_percent` (applied to both sides) into two
    independent rates: `guest_service_fee_percent` (keeps the existing value)
    and `host_service_fee_percent` (new, default 0 — removes the host-side
    deduction going forward; raise it in the admin to re-enable)."""

    dependencies = [
        ('payments', '0014_employee_employeepayment'),
    ]

    operations = [
        migrations.RenameField(
            model_name='platformfee',
            old_name='service_fee_percent',
            new_name='guest_service_fee_percent',
        ),
        migrations.AlterField(
            model_name='platformfee',
            name='guest_service_fee_percent',
            field=models.DecimalField(
                max_digits=5, decimal_places=2, default=Decimal('4.00'),
                help_text='Service fee percentage added ON TOP of what the guest pays (e.g. 4.00 charges the guest +4%).',
            ),
        ),
        migrations.AddField(
            model_name='platformfee',
            name='host_service_fee_percent',
            field=models.DecimalField(
                max_digits=5, decimal_places=2, default=Decimal('0.00'),
                help_text="Service fee percentage DEDUCTED from the host's payout. 0.00 means hosts keep the full booking amount; raise this to charge hosts a service fee again (no code change needed).",
            ),
        ),
    ]
