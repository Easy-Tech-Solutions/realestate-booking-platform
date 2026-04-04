import uuid
import base64
import requests
from django.core.management.base import BaseCommand
from payments.models import PaymentGateway


class Command(BaseCommand):
    help = 'Provision a new MTN MoMo sandbox API user and update the gateway credentials'

    def handle(self, *args, **options):
        try:
            gateway = PaymentGateway.objects.get(name='mtn_momo')
        except PaymentGateway.DoesNotExist:
            self.stdout.write(self.style.ERROR('No mtn_momo gateway found in admin. Create it first.'))
            return

        sub_key = gateway.api_key
        if not sub_key:
            self.stdout.write(self.style.ERROR('api_key (Collection Subscription Key) is empty on the gateway record.'))
            return

        base_url = gateway.sandbox_url.rstrip('/')
        new_user_id = str(uuid.uuid4())

        # Step 1 — create API user
        self.stdout.write(f'Step 1 — Creating sandbox API user: {new_user_id}')
        r1 = requests.post(
            f'{base_url}/v1_0/apiuser',
            headers={
                'X-Reference-Id': new_user_id,
                'Ocp-Apim-Subscription-Key': sub_key,
                'Content-Type': 'application/json',
            },
            json={'providerCallbackHost': 'localhost'},
            timeout=30,
        )
        self.stdout.write(f'  Status: {r1.status_code}  Body: {r1.text or "(empty)"}')
        if r1.status_code != 201:
            self.stdout.write(self.style.ERROR('Step 1 failed. Check your Collection Subscription Key (api_key field).'))
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

        # Step 4 — save to database
        gateway.merchant_id = new_user_id
        gateway.secret_key = api_key_secret
        gateway.save(update_fields=['merchant_id', 'secret_key'])

        self.stdout.write(self.style.SUCCESS('\nCredentials saved to database successfully!'))
        self.stdout.write(f'  merchant_id : {new_user_id}')
        self.stdout.write(f'  secret_key  : {api_key_secret}')
        self.stdout.write('\nYou can now retry the Postman payment request.')
