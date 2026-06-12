from django.db import migrations


def create_cache_table(apps, schema_editor):
    from django.conf import settings
    backend = settings.CACHES.get('default', {}).get('BACKEND', '')
    if 'DatabaseCache' in backend:
        location = settings.CACHES['default'].get('LOCATION', 'cache_table')
        from django.core.management import call_command
        call_command('createcachetable', location, verbosity=0)


class Migration(migrations.Migration):

    dependencies = [
        ('authapp', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_cache_table, migrations.RunPython.noop),
    ]
