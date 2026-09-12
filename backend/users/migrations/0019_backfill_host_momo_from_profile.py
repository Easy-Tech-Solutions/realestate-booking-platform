from django.db import migrations


def backfill_host_momo(apps, schema_editor):
    """Seed each approved host application's momo_number with the host's real
    registered payout number — which, before this change, lived on
    Profile.momo_number. This makes the new payout source of truth identical to
    the old one at cutover, and discards the old application 'phone' values that
    were never used for money. A blank profile number stays blank (payout is
    skipped, exactly as before). Runs BEFORE 0020 renames Profile.momo_number.
    """
    HostApplication = apps.get_model('hostapplications', 'HostApplication')
    Profile = apps.get_model('users', 'Profile')

    momo_by_user = dict(Profile.objects.values_list('user_id', 'momo_number'))

    for application in HostApplication.objects.filter(status='approved'):
        application.momo_number = momo_by_user.get(application.applicant_id, '') or ''
        application.save(update_fields=['momo_number'])


def noop_reverse(apps, schema_editor):
    # Non-reversible data backfill — leave values as-is on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0018_user_date_of_birth'),
        ('hostapplications', '0006_rename_phone_add_momo_network'),
    ]

    operations = [
        migrations.RunPython(backfill_host_momo, noop_reverse),
    ]
