import uuid
import base64
import requests
from django.conf import settings
from django.core.management.base import BaseCommand
from payments.models import PaymentGateway


class Command(BaseCommand):
    help = (
        'Provision a new MTN MoMo API user (sandbox by default, --live for production) and '
        'print the resulting MTN_MOMO_USER_ID / MTN_MOMO_API_SECRET for backend/.env.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--live', action='store_true',
            help='Provision against the live/production host (gateway.live_url) instead of sandbox.',
        )

    def handle(self, *args, **options):
        try:
            gateway = PaymentGateway.objects.get(name='mtn_momo')
        except PaymentGateway.DoesNotExist:
            self.stdout.write(self.style.ERROR('No mtn_momo gateway found in admin. Create it first.'))
            return

        # The Collection Subscription Key is env-sourced (MTN_MOMO_COLLECTION_KEY), not a DB
        # field — same for every other MTN credential except sandbox_mode/sandbox_url/
        # live_url, which stay on the PaymentGateway row. See payments/gateways/mtn_momo.py.
        sub_key = settings.PAYMENT_GATEWAYS.get('mtn_momo', {}).get('collection_key', '')
        if not sub_key:
            self.stdout.write(self.style.ERROR(
                'MTN_MOMO_COLLECTION_KEY is not set in backend/.env (Collection Subscription Key). '
                'Set it and redeploy the backend before running this.'
            ))
            return

        env = 'live' if options['live'] else 'sandbox'
        base_url = (gateway.live_url if options['live'] else gateway.sandbox_url).rstrip('/')
        if not base_url:
            field = 'live_url' if options['live'] else 'sandbox_url'
            self.stdout.write(self.style.ERROR(f'gateway.{field} is empty — set it in Django admin first.'))
            return

        new_user_id = str(uuid.uuid4())

        # Step 1 — create API user
        self.stdout.write(f'Step 1 — Creating {env} API user against {base_url}: {new_user_id}')
        r1 = requests.post(
            f'{base_url}/v1_0/apiuser',
            headers={
                'X-Reference-Id': new_user_id,
                'Ocp-Apim-Subscription-Key': sub_key,
                'Content-Type': 'application/json',
            },
            json={'providerCallbackHost': 'homekonet.com'},
            timeout=30,
        )
        self.stdout.write(f'  Status: {r1.status_code}  Body: {r1.text or "(empty)"}')
        if r1.status_code != 201:
            if options['live'] and r1.status_code == 404:
                self.stdout.write(self.style.ERROR(
                    "Step 1 failed with 404 'Resource not found'. This almost certainly means what it "
                    "looks like: MTN's production host does not expose self-service API-user creation — "
                    "/v1_0/apiuser is a sandbox-only convenience endpoint. In production, MTN issues the "
                    "API User ID + API Key directly as part of your go-live approval (check onboarding "
                    "email, the momodeveloper.mtn.com portal, or ask MTN/Lonestar Cell MTN integration "
                    "support) — you cannot generate them yourself the way this command does for sandbox."
                ))
            else:
                self.stdout.write(self.style.ERROR('Step 1 failed. Check your MTN_MOMO_COLLECTION_KEY (Collection Subscription Key).'))
            return

        # Step 2 — generate API key
        self.stdout.write('Step 2 — Generating API key...')
        r2 = requests.post(
            f'{base_url}/v1_0/apiuser/{new_user_id}/apikey',
            headers={'Ocp-Apim-Subscription-Key': sub_key},
            timeout=30,
        )
        self.stdout.write(f'  Status: {r2.status_code}  Body: {r2.text}')
        if r2.status_code != 201:
            self.stdout.write(self.style.ERROR('Step 2 failed.'))
            return

        api_key_secret = r2.json()['apiKey']

        # Step 3 — verify token
        self.stdout.write('Step 3 — Verifying token...')
        credentials = base64.b64encode(f'{new_user_id}:{api_key_secret}'.encode()).decode()
        r3 = requests.post(
            f'{base_url}/collection/token/',
            headers={
                'Authorization': f'Basic {credentials}',
                'Ocp-Apim-Subscription-Key': sub_key,
            },
            timeout=30,
        )
        self.stdout.write(f'  Status: {r3.status_code}')
        if r3.status_code != 200:
            self.stdout.write(self.style.ERROR(f'Token verification failed: {r3.text}'))
            return

        self.stdout.write(self.style.SUCCESS(f'\n{env.upper()} API user provisioned and verified successfully!'))
        self.stdout.write(self.style.WARNING(
            '\nThese are NOT written to the database — MTN credentials are env-sourced.'
            '\nAdd these two lines to backend/.env, then redeploy the backend:\n'
        ))
        self.stdout.write(f'  MTN_MOMO_USER_ID={new_user_id}')
        self.stdout.write(f'  MTN_MOMO_API_SECRET={api_key_secret}')
        self.stdout.write(
            '\n(This provisions the COLLECTION API user only. The Disbursement product uses its own '
            'subscription key — MTN_MOMO_DISBURSEMENT_KEY — but shares this same user_id/api_secret pair; '
            'no separate provisioning call is needed for it.)'
        )
