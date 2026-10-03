"""
python manage.py schedule_backup

Prints the crontab entry needed for nightly automated backups, and optionally
installs it into the current user's crontab.

On the production server this is already handled by /etc/cron.d/homekonet-backup
(see MIGRATION.md); --install refuses to add a duplicate entry when that file
exists.

Usage:
  python manage.py schedule_backup            # print the cron line only
  python manage.py schedule_backup --install  # add it to crontab (idempotent)
  python manage.py schedule_backup --remove   # remove it from crontab

The generated entry runs scripts/backup-cron.sh every night at 03:00 UTC,
which reads the passphrase from ~/.homekonet-backup-passphrase (600
permissions), prunes archives older than 14 days, and appends output to
/var/log/homekonet-backup.log.

Run this from the host (not inside a container) since it needs access to
docker compose and the host crontab.
"""
import os
import subprocess
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

CRON_MARKER = '# homekonet-nightly-backup'
CRON_LINE = (
    '0 3 * * *  /opt/homekonet/scripts/backup-cron.sh '
    '>> /var/log/homekonet-backup.log 2>&1  '
    + CRON_MARKER
)
SYSTEM_CRON_FILE = Path('/etc/cron.d/homekonet-backup')


class Command(BaseCommand):
    help = 'Print (or install/remove) the nightly backup cron entry.'

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group()
        group.add_argument('--install', action='store_true',
                           help='Add the nightly cron entry to the current user\'s crontab (idempotent).')
        group.add_argument('--remove', action='store_true',
                           help='Remove the nightly cron entry from the current user\'s crontab.')

    def handle(self, *args, **options):
        if options['install']:
            self._install()
        elif options['remove']:
            self._remove()
        else:
            self._print_instructions()

    # ------------------------------------------------------------------

    def _print_instructions(self):
        self.stdout.write(self.style.MIGRATE_HEADING('\n=== Nightly Backup — Setup Instructions ===\n'))
        if SYSTEM_CRON_FILE.exists():
            self.stdout.write(self.style.WARNING(
                f'Already scheduled system-wide via {SYSTEM_CRON_FILE} — nothing else to set up.\n\n'
            ))
        self.stdout.write('1. Store your GPG passphrase on the host (run once, as the deploy user):\n')
        self.stdout.write('   (umask 077; openssl rand -base64 32 > ~/.homekonet-backup-passphrase)\n')
        self.stdout.write('   Keep a copy off the server too — without it the archives can\'t be decrypted.\n\n')
        self.stdout.write('2. Add this line to your crontab (crontab -e), or run with --install:\n\n')
        self.stdout.write(f'   {CRON_LINE}\n\n')
        self.stdout.write('3. Verify the log after the first run:\n')
        self.stdout.write('   tail -f /var/log/homekonet-backup.log\n\n')
        self.stdout.write('4. Copy archives off the server regularly:\n')
        self.stdout.write('   ls -lh /opt/homekonet/backups/\n\n')
        self.stdout.write(self.style.WARNING(
            'NOTE: Run this command on the HOST (not inside a container) when using --install.\n'
            '      Inside a container, use the printed cron line on the host directly.\n'
        ))

    def _current_crontab(self):
        result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout
        # crontab -l exits 1 when there's no crontab yet — that's fine
        return ''

    def _install(self):
        if SYSTEM_CRON_FILE.exists():
            raise CommandError(
                f'Backups are already scheduled via {SYSTEM_CRON_FILE} — not adding a duplicate crontab entry.'
            )
        current = self._current_crontab()
        if CRON_MARKER in current:
            self.stdout.write(self.style.WARNING('Nightly backup cron entry already present — nothing changed.'))
            return

        new_crontab = current.rstrip('\n') + '\n' + CRON_LINE + '\n'
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cron', delete=False) as f:
            f.write(new_crontab)
            tmp = f.name

        try:
            result = subprocess.run(['crontab', tmp])
            if result.returncode != 0:
                raise CommandError('crontab command failed — are you running this on the host as a user with crontab access?')
        finally:
            os.unlink(tmp)

        self.stdout.write(self.style.SUCCESS('Nightly backup cron entry installed.'))
        self.stdout.write(f'  Schedule: every night at 03:00 UTC\n')
        self.stdout.write(f'  Log:      /var/log/homekonet-backup.log\n')
        self.stdout.write(f'  Archive:  /opt/homekonet/backups/\n')
        self.stdout.write(self.style.WARNING(
            '\nMake sure ~/.homekonet-backup-passphrase exists (chmod 600) and /var/log/homekonet-backup.log\n'
            'is writable by this user before the first run.\n'
        ))

    def _remove(self):
        current = self._current_crontab()
        if CRON_MARKER not in current:
            self.stdout.write(self.style.WARNING('No nightly backup cron entry found — nothing to remove.'))
            return

        new_lines = [line for line in current.splitlines() if CRON_MARKER not in line]
        new_crontab = '\n'.join(new_lines) + '\n'

        with tempfile.NamedTemporaryFile(mode='w', suffix='.cron', delete=False) as f:
            f.write(new_crontab)
            tmp = f.name

        try:
            result = subprocess.run(['crontab', tmp])
            if result.returncode != 0:
                raise CommandError('crontab command failed.')
        finally:
            os.unlink(tmp)

        self.stdout.write(self.style.SUCCESS('Nightly backup cron entry removed.'))
