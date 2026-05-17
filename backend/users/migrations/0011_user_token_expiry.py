from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0010_profile_superhost'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='email_verification_token_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='password_reset_token_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='user',
            name='email_verification_token',
            field=models.CharField(blank=True, max_length=200, null=True),
        ),
        migrations.AlterField(
            model_name='user',
            name='password_reset_token',
            field=models.CharField(blank=True, max_length=200, null=True),
        ),
    ]
