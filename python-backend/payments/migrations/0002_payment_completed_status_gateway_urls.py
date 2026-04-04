from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0001_initial'),
    ]

    operations = [
        # Add sandbox_url and live_url to PaymentGateway
        migrations.AddField(
            model_name='paymentgateway',
            name='sandbox_url',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='paymentgateway',
            name='live_url',
            field=models.CharField(blank=True, max_length=255),
        ),
        # Add 'completed' to Payment status choices
        migrations.AlterField(
            model_name='payment',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('processing', 'Processing'),
                    ('completed', 'Completed'),
                    ('failed', 'Failed'),
                    ('cancelled', 'Cancelled'),
                    ('refunded', 'Refunded'),
                    ('partially_refunded', 'Partially Refunded'),
                ],
                default='pending',
                max_length=20,
            ),
        ),
    ]
