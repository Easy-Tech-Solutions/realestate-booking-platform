from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0011_rename_homes_to_apartment'),
    ]

    operations = [
        migrations.CreateModel(
            name='HotelRoom',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('room_type', models.CharField(
                    choices=[
                        ('standard', 'Standard'), ('deluxe', 'Deluxe'), ('suite', 'Suite'),
                        ('family', 'Family'), ('studio', 'Studio'), ('penthouse', 'Penthouse'),
                    ],
                    default='standard', max_length=20,
                )),
                ('description', models.TextField(blank=True)),
                ('price_per_night', models.DecimalField(decimal_places=2, max_digits=12)),
                ('max_occupancy', models.PositiveIntegerField(default=2)),
                ('beds', models.PositiveIntegerField(default=1)),
                ('bed_type', models.CharField(
                    choices=[
                        ('king', 'King'), ('queen', 'Queen'), ('twin', 'Twin'),
                        ('double', 'Double'), ('single', 'Single'), ('bunk', 'Bunk'),
                    ],
                    default='queen', max_length=20,
                )),
                ('bathrooms', models.PositiveIntegerField(default=1)),
                ('amenities', models.JSONField(blank=True, default=list)),
                ('total_count', models.PositiveIntegerField(default=1)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('listing', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='hotel_rooms',
                    to='listings.listing',
                )),
            ],
            options={
                'ordering': ['room_type', 'price_per_night'],
            },
        ),
    ]
