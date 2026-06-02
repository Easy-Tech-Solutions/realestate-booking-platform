from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0012_profile_last_seen'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='deleted_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
