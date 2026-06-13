from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0015_listing_pending_review_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='listing',
            name='deleted_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
