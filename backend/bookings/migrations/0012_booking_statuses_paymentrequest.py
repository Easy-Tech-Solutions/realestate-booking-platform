from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0011_booking_stripe_payment_intent_id'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='booking',
            name='status',
            field=models.CharField(
                choices=[
                    ('requested', 'Requested'),
                    ('payment_requested', 'Payment Requested'),
                    ('payment_received', 'Payment Received'),
                    ('confirmed', 'Confirmed'),
                    ('declined', 'Declined'),
                    ('cancelled', 'Cancelled'),
                    ('completed', 'Completed'),
                ],
                default='requested',
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name='PaymentRequest',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('currency', models.CharField(default='USD', max_length=3)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('is_paid', models.BooleanField(default=False)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('stripe_payment_intent_id', models.CharField(blank=True, max_length=100, null=True)),
                ('booking', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='payment_request', to='bookings.booking')),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payment_requests_sent', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
