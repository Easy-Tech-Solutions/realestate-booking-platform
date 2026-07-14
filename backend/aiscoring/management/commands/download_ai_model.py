import hashlib
import os

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Download the local AI scoring model (GGUF) if not already present, and verify its checksum.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', action='store_true',
            help='Re-download even if a file already exists at AI_MODEL_PATH.',
        )

    def handle(self, *args, **options):
        model_path = str(settings.AI_MODEL_PATH)
        os.makedirs(settings.AI_MODEL_DIR, exist_ok=True)

        if os.path.exists(model_path) and not options['force']:
            if self._sha256_matches(model_path):
                self.stdout.write(self.style.SUCCESS(f'Model already present and verified at {model_path}'))
                self._delete_old_models()
                return
            self.stdout.write(self.style.WARNING(f'Existing file at {model_path} failed checksum — re-downloading'))

        self.stdout.write(f'Downloading {settings.AI_MODEL_URL} -> {model_path} ...')
        tmp_path = model_path + '.part'
        try:
            with requests.get(settings.AI_MODEL_URL, stream=True, timeout=60) as resp:
                resp.raise_for_status()
                with open(tmp_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                        if chunk:
                            f.write(chunk)
        except requests.RequestException as exc:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise CommandError(f'Download failed: {exc}')

        if not self._sha256_matches(tmp_path):
            os.remove(tmp_path)
            raise CommandError(
                'Downloaded file failed sha256 verification against AI_MODEL_SHA256 — deleted, not installed.'
            )

        os.replace(tmp_path, model_path)
        self.stdout.write(self.style.SUCCESS(f'Model downloaded and verified at {model_path}'))
        self._delete_old_models()

    def _delete_old_models(self):
        for old in settings.AI_MODEL_DIR.iterdir():
            if old.suffix == '.gguf' and old != settings.AI_MODEL_PATH:
                old.unlink()
                self.stdout.write(self.style.WARNING(f'Deleted old model: {old}'))

    def _sha256_matches(self, path):
        expected = settings.AI_MODEL_SHA256
        if not expected:
            return True
        digest = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
                digest.update(chunk)
        return digest.hexdigest() == expected
