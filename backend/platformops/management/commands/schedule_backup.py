"""
python manage.py schedule_backup

Prints the crontab entry needed for weekly automated backups, and optionally
installs it into the current user's crontab.

Usage:
  python manage.py schedule_backup            # print the cron line only
  python manage.py schedule_backup --install  # add it to crontab (idempotent)
  python manage.py schedule_backup --remove   # remove it from crontab

The generated entry runs every Sunday at 03:00 UTC, stores the passphrase in
/root/.backup-passphrase (600 permissions), and appends output to
/var/log/homekonet-backup.log.

Run this from the host (not inside a container) since it needs access to
docker compose and the host crontab.
"""
import os
import subprocess
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

CRON_MARKER = '# homekonet-weekly-backup'
CRON_LINE = (
    '0 3 * * 0  cd /opt/homekonet && '
    'BACKUP_PASSPHRASE="$(cat /root/.backup-passphrase)" '
    'bash scripts/backup.sh >> /var/log/homekonet-backup.log 2>&1  '
    + CRON_MARKER
)


class Command(BaseCommand):
    help = 'Print (or install/remove) the weekly backup cron entry.'

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group()
        group.add_argument('--install', action='store_true',
                           help='Add the weekly cron entry to the current user\'s crontab (idempotent).')
        group.add_argument('--remove', action='store_true',
                           help='Remove the weekly cron entry from the current user\'s crontab.')

    def handle(self, *args, **options):
        if options['install']:
            self._install()
        elif options['remove']:
            self._remove()
        else:
            self._print_instructions()

    # ------------------------------------------------------------------

    def _print_instructions(self):
        self.stdout.write(self.style.MIGRATE_HEADING('\n=== Weekly Backup — Setup Instructions ===\n'))
        self.stdout.write('1. Store your GPG passphrase on the host (run once, as root):\n')
        self.stdout.write('   echo "your-strong-passphrase" > /root/.backup-passphrase\n')
        self.stdout.write('   chmod 600 /root/.backup-passphrase\n\n')
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
        current = self._current_crontab()
        if CRON_MARKER in current:
            self.stdout.write(self.style.WARNING('Weekly backup cron entry already present — nothing changed.'))
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

        self.stdout.write(self.style.SUCCESS('Weekly backup cron entry installed.'))
        self.stdout.write(f'  Schedule: every Sunday at 03:00 UTC\n')
        self.stdout.write(f'  Log:      /var/log/homekonet-backup.log\n')
        self.stdout.write(f'  Archive:  /opt/homekonet/backups/\n')
        self.stdout.write(self.style.WARNING(
            '\nMake sure /root/.backup-passphrase exists (chmod 600) before the first run.\n'
        ))

    def _remove(self):
        current = self._current_crontab()
        if CRON_MARKER not in current:
            self.stdout.write(self.style.WARNING('No weekly backup cron entry found — nothing to remove.'))
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

        self.stdout.write(self.style.SUCCESS('Weekly backup cron entry removed.'))
