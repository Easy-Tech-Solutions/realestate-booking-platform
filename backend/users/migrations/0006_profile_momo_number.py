from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_remove_user_picture_profile'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='momo_number',
            field=models.CharField(
                blank=True,
                help_text='MTN Mobile Money number for receiving payouts (Liberian format, e.g. 0770123456)',
                max_length=20,
            ),
        ),
    ]
