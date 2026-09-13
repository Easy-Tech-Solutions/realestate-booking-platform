# Generated for the property-verification page-number field.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('propertyverifications', '0006_propertyverification_owner_authorization_confirmed_and_more'),
    ]

    operations = [
        # Blank/default so adding the column to the already-populated table is a
        # fast, non-interactive metadata-only change (Postgres 11+). Required is
        # enforced for new submissions in PropertyVerificationCreateSerializer.
        migrations.AddField(
            model_name='propertyverification',
            name='page_number',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]
