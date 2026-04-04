import re
import uuid
import base64
import requests
import hashlib
import hmac
import json
from typing import Dict, Any
from django.core.cache import cache
from .base import PaymentGatewayBase


class MTNMoMoGateway(PaymentGatewayBase):
    """
    MTN Mobile Money Gateway for Liberia.

    Uses the MTN MoMo Collection API (Request to Pay) for customer payments
    and the Disbursement API (Transfer) for paying property owners.

    Credentials stored on the PaymentGateway model:
        api_key        → Collection product subscription key (Ocp-Apim-Subscription-Key)
        merchant_id    → Collection API user ID
        secret_key     → Collection API key (used in Basic Auth for OAuth2 token)
        business_number → Disbursement product subscription key
        webhook_secret → HMAC secret for validating incoming webhook payloads
    """

    # MTN MoMo API path segments
    COLLECTION_TOKEN_PATH = 'collection/token/'
    COLLECTION_REQUEST_PATH = 'collection/v1_0/requesttopay'
    DISBURSEMENT_TOKEN_PATH = 'disbursement/token/'
    DISBURSEMENT_TRANSFER_PATH = 'disbursement/v1_0/transfer'

    def __init__(self, gateway_config):
        super().__init__(gateway_config)
        self.subscription_key = gateway_config.api_key          # Collection subscription key
        self.user_id = gateway_config.merchant_id               # Collection API user ID
        self.api_key_secret = gateway_config.secret_key         # Collection API key (Basic Auth)
        self.disbursement_key = gateway_config.business_number  # Disbursement subscription key
        self.webhook_secret = gateway_config.webhook_secret
        self.target_env = 'sandbox' if self.is_sandbox else 'production'

    # ------------------------------------------------------------------ #
    #  OAuth2 token management                                            #
    # ------------------------------------------------------------------ #

    def _get_access_token(self, product: str = 'collection') -> str:
        """
        Fetch (or return a cached) OAuth2 Bearer token for the given product.
        Tokens are cached for 50 minutes (MTN tokens expire in 60 minutes).
        """
        cache_key = f'mtn_momo_{product}_token'
        token = cache.get(cache_key)
        if token:
            return token

        if product == 'collection':
            token_url = self.get_api_url(self.COLLECTION_TOKEN_PATH)
            sub_key = self.subscription_key
            basic_user = self.user_id
            basic_pass = self.api_key_secret
        else:
            token_url = self.get_api_url(self.DISBURSEMENT_TOKEN_PATH)
            sub_key = self.disbursement_key or self.subscription_key
            basic_user = self.user_id
            basic_pass = self.api_key_secret

        credentials = base64.b64encode(
            f'{basic_user}:{basic_pass}'.encode()
        ).decode()

        response = requests.post(
            token_url,
            headers={
                'Authorization': f'Basic {credentials}',
                'Ocp-Apim-Subscription-Key': sub_key,
            },
            timeout=30,
        )
        response.raise_for_status()
        token = response.json()['access_token']
        cache.set(cache_key, token, timeout=50 * 60)
        return token

    def _collection_headers(self, reference_id: str = None) -> Dict[str, str]:
        token = self._get_access_token('collection')
        headers = {
            'Authorization': f'Bearer {token}',
            'Ocp-Apim-Subscription-Key': self.subscription_key,
            'X-Target-Environment': self.target_env,
            'Content-Type': 'application/json',
        }
        if reference_id:
            headers['X-Reference-Id'] = reference_id
        return headers

    def _disbursement_headers(self, reference_id: str = None) -> Dict[str, str]:
        token = self._get_access_token('disbursement')
        sub_key = self.disbursement_key or self.subscription_key
        headers = {
            'Authorization': f'Bearer {token}',
            'Ocp-Apim-Subscription-Key': sub_key,
            'X-Target-Environment': self.target_env,
            'Content-Type': 'application/json',
        }
        if reference_id:
            headers['X-Reference-Id'] = reference_id
        return headers

    # ------------------------------------------------------------------ #
    #  Core payment flow (Collection API)                                 #
    # ------------------------------------------------------------------ #

    def process_payment(self, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a Request-to-Pay push to the customer's MTN MoMo account.
        Returns immediately with status='pending'; the actual confirmation
        arrives via webhook or polling (verify_payment).
        """
        try:
            amount = payment_data.get('amount')
            phone_number = payment_data.get('phone_number')
            currency = payment_data.get('currency', 'LRD')
            payment_id = payment_data.get('payment_id')  # our internal Payment UUID

            if not self.is_sandbox and not self._validate_liberian_phone(phone_number):
                return {
                    'success': False,
                    'error': 'Invalid Liberian MTN number. Use format: 0770123456 or +231770123456',
                }

            formatted_phone = phone_number if self.is_sandbox else self._format_phone_number(phone_number)

            # Use a fresh UUID as the MTN reference; store it as gateway_transaction_id
            momo_reference = str(uuid.uuid4())

            # MTN requires a whole-number string — no decimals (e.g. "150" not "150.0")
            from decimal import Decimal as _D
            formatted_amount = str(int(_D(str(amount)).to_integral_value()))

            body = {
                'amount': formatted_amount,
                'currency': currency,
                'externalId': str(payment_id),   # our Payment UUID → used in webhook lookup
                'payer': {
                    'partyIdType': 'MSISDN',
                    'partyId': formatted_phone,
                },
                'payerMessage': 'Property booking payment',
                'payeeNote': 'Real Estate Platform - Liberia',
            }

            url = self.get_api_url(self.COLLECTION_REQUEST_PATH)
            headers = self._collection_headers(reference_id=momo_reference)

            response = requests.post(url, json=body, headers=headers, timeout=30)

            # MTN MoMo returns 202 Accepted with an empty body on success
            if response.status_code == 202:
                return {
                    'success': True,
                    'transaction_id': momo_reference,  # store as gateway_transaction_id
                    'status': 'pending',
                    'message': 'Payment request sent to customer phone. Awaiting approval.',
                }

            # Capture as much detail as possible for debugging
            try:
                error_detail = response.json()
            except Exception:
                error_detail = response.text or '(empty body)'

            return {
                'success': False,
                'error': f'MTN API error {response.status_code}',
                'details': error_detail,
                'debug': {
                    'url': url,
                    'request_body': body,
                    'response_headers': dict(response.headers),
                } if self.is_sandbox else {},
            }

        except requests.exceptions.RequestException as e:
            return {'success': False, 'error': 'Network error', 'details': str(e)}
        except Exception as e:
            return {'success': False, 'error': 'Payment processing error', 'details': str(e)}

    def verify_payment(self, transaction_id: str) -> Dict[str, Any]:
        """
        Poll the MTN MoMo API for the current status of a transaction.
        transaction_id is the UUID we originally sent as X-Reference-Id.
        """
        try:
            url = self.get_api_url(f'{self.COLLECTION_REQUEST_PATH}/{transaction_id}')
            response = requests.get(
                url,
                headers=self._collection_headers(),
                timeout=30,
            )

            if response.status_code == 200:
                data = response.json()
                mtn_status = data.get('status', '')

                status_map = {
                    'PENDING': 'pending',
                    'SUCCESSFUL': 'completed',
                    'FAILED': 'failed',
                    'TIMEOUT': 'failed',
                }

                payer = data.get('payer') or {}
                return {
                    'success': True,
                    'status': status_map.get(mtn_status, 'pending'),
                    'mtn_status': mtn_status,
                    'amount': data.get('amount'),
                    'currency': data.get('currency'),
                    'phone_number': payer.get('partyId', ''),
                    'financial_transaction_id': data.get('financialTransactionId', ''),
                    'paid_at': data.get('completedTimestamp'),
                    'gateway_data': data,
                }

            return {
                'success': False,
                'error': f'Verification failed: {response.status_code}',
                'details': response.text,
            }

        except Exception as e:
            return {'success': False, 'error': 'Verification error', 'details': str(e)}

    def refund_payment(self, payment, amount: float, reason: str) -> Dict[str, Any]:
        """
        Refund by sending a disbursement back to the original payer's number.
        MTN MoMo Collection has no native refund endpoint; we use the
        Disbursement Transfer API to return funds.
        """
        phone_number = payment.phone_number
        if not phone_number:
            return {'success': False, 'error': 'No phone number on record for this payment'}

        return self._disburse(
            phone_number=phone_number,
            amount=float(amount),
            currency=payment.currency.code,
            note=f'Refund for booking payment {payment.id}. Reason: {reason}',
        )

    # ------------------------------------------------------------------ #
    #  Owner payout (Disbursement API)                                    #
    # ------------------------------------------------------------------ #

    def transfer_to_owner(self, owner_phone: str, amount: float,
                          currency: str, booking_ref: str) -> Dict[str, Any]:
        """
        Disburse the booking payment to the property owner's MoMo account.
        Call this after the customer's payment is confirmed.
        """
        if not self._validate_liberian_phone(owner_phone):
            return {
                'success': False,
                'error': 'Invalid owner MoMo number. Cannot disburse payment.',
            }

        return self._disburse(
            phone_number=owner_phone,
            amount=amount,
            currency=currency,
            note=f'Property rental payout – Booking {booking_ref}',
        )

    def _disburse(self, phone_number: str, amount: float,
                  currency: str, note: str) -> Dict[str, Any]:
        """Shared logic for both refunds and owner payouts via Disbursement API."""
        try:
            formatted_phone = self._format_phone_number(phone_number)
            reference = str(uuid.uuid4())

            body = {
                'amount': str(amount),
                'currency': currency,
                'externalId': reference,
                'payee': {
                    'partyIdType': 'MSISDN',
                    'partyId': formatted_phone,
                },
                'payerMessage': note,
                'payeeNote': note,
            }

            response = requests.post(
                self.get_api_url(self.DISBURSEMENT_TRANSFER_PATH),
                json=body,
                headers=self._disbursement_headers(reference_id=reference),
                timeout=30,
            )

            if response.status_code == 202:
                return {
                    'success': True,
                    'refund_id': reference,
                    'status': 'pending',
                    'message': 'Disbursement submitted successfully.',
                }

            error_detail = ''
            try:
                error_detail = response.json()
            except Exception:
                error_detail = response.text

            return {
                'success': False,
                'error': f'Disbursement API error {response.status_code}',
                'details': error_detail,
            }

        except requests.exceptions.RequestException as e:
            return {'success': False, 'error': 'Network error during disbursement', 'details': str(e)}
        except Exception as e:
            return {'success': False, 'error': 'Disbursement error', 'details': str(e)}

    # ------------------------------------------------------------------ #
    #  Webhook validation                                                  #
    # ------------------------------------------------------------------ #

    def validate_webhook(self, payload: Dict[str, Any], signature: str) -> bool:
        """
        Validate MTN MoMo webhook payload using HMAC-SHA256 with webhook_secret.
        """
        if not self.webhook_secret:
            return False
        try:
            json_payload = json.dumps(payload, separators=(',', ':'), sort_keys=True)
            expected = hmac.new(
                self.webhook_secret.encode('utf-8'),
                json_payload.encode('utf-8'),
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, signature)
        except Exception:
            return False

    # ------------------------------------------------------------------ #
    #  Phone number helpers                                               #
    # ------------------------------------------------------------------ #

    def _validate_liberian_phone(self, phone_number: str) -> bool:
        """
        Validate Liberian MTN MoMo phone numbers.
        MTN Liberia prefixes: 077, 088 (local) → 231-77-XXXXXXX / 231-88-XXXXXXX.
        Accepts: +231770123456 | 0770123456 | 770123456
        """
        if not phone_number:
            return False
        clean = re.sub(r'\D', '', phone_number)

        patterns = [
            r'^231(77|88)\d{7}$',   # International: 23177XXXXXXX or 23188XXXXXXX
            r'^0(77|88)\d{7}$',     # Local with leading 0: 077XXXXXXX or 088XXXXXXX
            r'^(77|88)\d{7}$',      # Bare: 77XXXXXXX or 88XXXXXXX
        ]
        return any(re.match(p, clean) for p in patterns)

    def _format_phone_number(self, phone_number: str) -> str:
        """
        Normalise to international MSISDN format without + (e.g. 231770123456).
        Required by the MTN MoMo API.
        """
        clean = re.sub(r'\D', '', phone_number)

        if clean.startswith('231'):
            return clean
        if clean.startswith('0'):
            return f'231{clean[1:]}'
        # bare 9-digit local number (e.g. 770123456)
        return f'231{clean}'
