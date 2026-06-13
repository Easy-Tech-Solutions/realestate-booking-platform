from django.db import migrations, models
from decimal import Decimal


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0003_savedcard'),
    ]

    operations = [
        migrations.CreateModel(
            name='PlatformFee',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('booking_fee', models.DecimalField(decimal_places=2, default=Decimal('3.00'), help_text='Flat fee charged at booking time (USD)', max_digits=8)),
                ('transaction_fee_type', models.CharField(choices=[('fixed', 'Fixed Amount (USD)'), ('percentage', 'Percentage of transaction'), ('range', 'Range (Min–Max USD)')], default='fixed', help_text='How the payment-method transaction fee is calculated', max_length=20)),
                ('transaction_fee_value', models.DecimalField(decimal_places=4, default=Decimal('0.00'), help_text='Fixed USD amount or percentage rate (e.g. 2.9 for 2.9%)', max_digits=8)),
                ('transaction_fee_min', models.DecimalField(blank=True, decimal_places=2, help_text='Minimum USD fee (range type only)', max_digits=8, null=True)),
                ('transaction_fee_max', models.DecimalField(blank=True, decimal_places=2, help_text='Maximum USD fee (range type only)', max_digits=8, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Platform Fee Configuration',
                'verbose_name_plural': 'Platform Fee Configuration',
            },
        ),
    ]
