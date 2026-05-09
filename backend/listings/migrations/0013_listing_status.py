from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0012_hotelroom'),
    ]

    operations = [
        migrations.AddField(
            model_name='listing',
            name='status',
            field=models.CharField(
                choices=[('draft', 'Draft'), ('published', 'Published')],
                default='published',
                max_length=20,
            ),
        ),
    ]
