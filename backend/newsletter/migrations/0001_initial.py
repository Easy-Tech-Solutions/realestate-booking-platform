from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Subscriber',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254, unique=True)),
                ('first_name', models.CharField(blank=True, max_length=100)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('interests', models.JSONField(blank=True, default=list)),
                ('unsubscribe_token', models.CharField(editable=False, max_length=64, unique=True)),
                ('subscribed_at', models.DateTimeField(auto_now_add=True)),
                ('unsubscribed_at', models.DateTimeField(blank=True, null=True)),
            ],
            options={'ordering': ['-subscribed_at']},
        ),
    ]
