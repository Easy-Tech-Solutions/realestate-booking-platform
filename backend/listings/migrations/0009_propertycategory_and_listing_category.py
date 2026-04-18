from django.db import migrations, models


DEFAULT_CATEGORY_SLUGS = {
    'homes',
    'hotels',
    'lodge',
    'beaches',
    'roadside',
    'highway',
    'land',
    'office-space',
    'hall',
}


def seed_categories_and_backfill_listings(apps, schema_editor):
    PropertyCategory = apps.get_model('listings', 'PropertyCategory')
    Listing = apps.get_model('listings', 'Listing')

    defaults = [
        ('Homes', 'homes'),
        ('Hotels', 'hotels'),
        ('Lodge', 'lodge'),
        ('Beaches', 'beaches'),
        ('Roadside', 'roadside'),
        ('Highway', 'highway'),
        ('Land', 'land'),
        ('Office Space', 'office-space'),
        ('Hall', 'hall'),
    ]

    for index, (name, slug) in enumerate(defaults):
        PropertyCategory.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'is_active': True,
                'sort_order': index,
            },
        )

    for listing in Listing.objects.all().iterator():
        category = (listing.property_type or '').strip().lower()
        if category not in DEFAULT_CATEGORY_SLUGS:
            listing.property_type = 'homes'
            listing.save(update_fields=['property_type'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0008_review_categories_cancellation'),
    ]

    operations = [
        migrations.CreateModel(
            name='PropertyCategory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80, unique=True)),
                ('slug', models.SlugField(max_length=100, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('sort_order', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['sort_order', 'name']},
        ),
        migrations.AlterField(
            model_name='listing',
            name='property_type',
            field=models.CharField(default='homes', max_length=50),
        ),
        migrations.RunPython(seed_categories_and_backfill_listings, noop_reverse),
    ]
