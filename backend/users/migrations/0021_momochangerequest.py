import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0020_rename_profile_momo_to_phone'),
    ]

    operations = [
        migrations.CreateModel(
            name='MomoChangeRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('new_momo_number', models.CharField(max_length=30)),
                ('network_provider', models.CharField(choices=[('mtn', 'MTN Mobile Money'), ('orange', 'Orange Money')], default='mtn', help_text='Which wallet this number belongs to (only MTN is payable today)', max_length=10)),
                ('password_verified', models.BooleanField(default=False)),
                ('email_otp', models.CharField(max_length=6)),
                ('email_otp_expiry', models.DateTimeField()),
                ('email_otp_verified', models.BooleanField(default=False)),
                ('sms_otp', models.CharField(blank=True, max_length=6)),
                ('sms_otp_expiry', models.DateTimeField(blank=True, null=True)),
                ('sms_otp_verified', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='momo_change_request', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
