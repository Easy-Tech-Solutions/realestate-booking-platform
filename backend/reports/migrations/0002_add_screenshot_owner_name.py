from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reports', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='report',
            name='owner_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='report',
            name='screenshot',
            field=models.ImageField(blank=True, null=True, upload_to='reports/screenshots/'),
        ),
    ]
