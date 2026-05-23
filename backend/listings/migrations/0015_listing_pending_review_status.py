from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0014_hotelroomimage'),
    ]

    operations = [
        migrations.AlterField(
            model_name='listing',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', 'Draft'),
                    ('pending_review', 'Pending Review'),
                    ('published', 'Published'),
                    ('rejected', 'Rejected'),
                ],
                default='pending_review',
                max_length=20,
            ),
        ),
    ]
