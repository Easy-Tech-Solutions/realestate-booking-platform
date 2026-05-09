"""
Management command to generate VAPID key pair for Web Push notifications.

Usage:
    python manage.py generate_vapid_keys

Copy the printed values into your environment variables:
    VAPID_PRIVATE_KEY=<private key>
    VAPID_PUBLIC_KEY=<public key>
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Generate a VAPID key pair for Web Push notifications'

    def handle(self, *args, **options):
        try:
            from py_vapid import Vapid
        except ImportError:
            self.stderr.write(self.style.ERROR(
                'pywebpush is not installed. Run: pip install pywebpush'
            ))
            return

        vapid = Vapid()
        vapid.generate_keys()

        private_key = vapid.private_key_urlsafe
        public_key = vapid.public_key_urlsafe

        self.stdout.write(self.style.SUCCESS('\n✓ VAPID keys generated\n'))
        self.stdout.write('Add these to your environment / .env file:\n')
        self.stdout.write(f'\nVAPID_PRIVATE_KEY={private_key}')
        self.stdout.write(f'VAPID_PUBLIC_KEY={public_key}')
        self.stdout.write(f'VAPID_CLAIMS_EMAIL=admin@yourdomain.com\n')
        self.stdout.write(self.style.WARNING(
            '\nKeep VAPID_PRIVATE_KEY secret. VAPID_PUBLIC_KEY goes to the frontend.\n'
        ))
