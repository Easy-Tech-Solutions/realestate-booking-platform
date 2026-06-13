from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0013_user_deleted_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='is_archived',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='user',
            name='archived_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='scheduled_deletion_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
