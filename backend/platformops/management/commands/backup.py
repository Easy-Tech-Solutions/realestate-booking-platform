"""
python manage.py backup

Runs scripts/backup.sh from within the Django management command framework,
so operators can trigger a backup with the same `manage.py <command>`
convention used for every other admin/maintenance task in this app
(reconcile_payments, backfill_payouts, etc).

MUST be run via the HOST virtualenv (/opt/homekonet/.venv), e.g.:
  cd /opt/homekonet && .venv/bin/python backend/manage.py backup --full

NOT via `docker compose exec backend python manage.py backup` — the backend
container doesn't have the `scripts/` directory (only backend/ is copied
into the image), and doesn't have the docker/gpg/pg_dump binaries backup.sh
needs to orchestrate the *other* containers and volumes. This command
detects that case and fails fast with a clear message rather than a
confusing low-level error.

Options mirror backup.sh exactly:
  --include-ai-models   Include the ~3 GB local LLM volume
  --include-redis       Include the Redis data volume
  --full                Both of the above
  --passphrase TEXT     GPG passphrase (non-interactive). If omitted, the
                        BACKUP_PASSPHRASE env var is used; if that's also
                        absent, gpg prompts interactively.
"""
import os
import shutil
import subprocess
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Create an encrypted backup archive (wraps scripts/backup.sh). Host venv only — see docstring.'

    def add_arguments(self, parser):
        parser.add_argument('--include-ai-models', action='store_true',
                            help='Include the ~3 GB local LLM volume in the archive.')
        parser.add_argument('--include-redis', action='store_true',
                            help='Include the Redis data volume in the archive.')
        parser.add_argument('--full', action='store_true',
                            help='Equivalent to --include-ai-models --include-redis.')
        parser.add_argument('--passphrase', type=str, default='',
                            help='GPG passphrase for non-interactive use (overrides BACKUP_PASSPHRASE env var).')

    def handle(self, *args, **options):
        # backend/platformops/management/commands/backup.py -> repo root is 4 levels up.
        repo_root = Path(__file__).resolve().parents[4]
        script = repo_root / 'scripts' / 'backup.sh'

        if not script.exists():
            raise CommandError(
                f'Backup script not found at {script}. This command must be run via the host '
                'virtualenv (.venv/bin/python backend/manage.py backup), not inside a Docker '
                'container — the backend image only contains backend/, not scripts/.'
            )
        if shutil.which('docker') is None:
            raise CommandError(
                'The `docker` CLI is not on PATH. This command must be run on the HOST '
                '(cd /opt/homekonet && .venv/bin/python backend/manage.py backup), not inside '
                'a container — backup.sh needs `docker compose exec/run` to reach the other '
                'services and volumes.'
            )

        cmd = ['bash', str(script)]
        if options['full']:
            cmd.append('--full')
        else:
            if options['include_ai_models']:
                cmd.append('--include-ai-models')
            if options['include_redis']:
                cmd.append('--include-redis')

        env = os.environ.copy()
        passphrase = options['passphrase'] or env.get('BACKUP_PASSPHRASE', '')
        if passphrase:
            env['BACKUP_PASSPHRASE'] = passphrase

        self.stdout.write(self.style.MIGRATE_HEADING('==> Starting backup …'))
        result = subprocess.run(cmd, env=env, cwd=str(repo_root))

        if result.returncode != 0:
            raise CommandError(f'backup.sh exited with code {result.returncode}')

        self.stdout.write(self.style.SUCCESS('==> Backup completed successfully.'))
