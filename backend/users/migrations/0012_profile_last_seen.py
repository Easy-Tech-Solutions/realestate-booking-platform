from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_user_token_expiry'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='last_seen',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
