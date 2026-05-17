from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0002_messaging_features'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='reply_to',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='replies',
                to='messaging.message',
            ),
        ),
    ]
