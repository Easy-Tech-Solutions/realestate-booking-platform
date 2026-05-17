from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0009_propertycategory_and_listing_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='listing',
            name='city',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='listing',
            name='state',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='listing',
            name='country',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='listing',
            name='latitude',
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name='listing',
            name='longitude',
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name='listing',
            name='check_in_time',
            field=models.CharField(default='15:00', max_length=10),
        ),
        migrations.AddField(
            model_name='listing',
            name='check_out_time',
            field=models.CharField(default='11:00', max_length=10),
        ),
        migrations.AddField(
            model_name='listing',
            name='self_checkin',
            field=models.BooleanField(default=False),
        ),
    ]
