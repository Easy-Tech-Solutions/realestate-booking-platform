from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0002_payment_completed_status_gateway_urls'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SavedCard',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cardholder_name', models.CharField(max_length=100)),
                ('last4', models.CharField(max_length=4)),
                ('card_type', models.CharField(
                    max_length=20,
                    choices=[
                        ('visa', 'Visa'),
                        ('mastercard', 'Mastercard'),
                        ('amex', 'American Express'),
                        ('discover', 'Discover'),
                        ('other', 'Other'),
                    ],
                    default='other',
                )),
                ('expiry_month', models.CharField(max_length=2)),
                ('expiry_year', models.CharField(max_length=4)),
                ('is_default', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='saved_cards',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-is_default', '-created_at'],
            },
        ),
    ]
