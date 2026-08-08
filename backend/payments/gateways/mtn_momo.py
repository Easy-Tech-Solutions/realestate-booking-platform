import re
import uuid
import base64
import requests
from typing import Dict, Any
from django.conf import settings
from django.core.cache import cache
from .base import PaymentGatewayBase


class MTNMoMoGateway(PaymentGatewayBase):
    """
    MTN Mobile Money Gateway for Liberia.

    Uses the MTN MoMo Collection API (Request to Pay) for customer payments
    and the Disbursement API (Transfer) for paying property owners.

    Credentials come from environment variables (settings.PAYMENT_GATEWAYS),
    the same pattern used for STRIPE_SECRET_KEY — never stored in the
    database. Only sandbox_mode/sandbox_url/live_url stay on the
    PaymentGateway model row, since those aren't secrets and are convenient
    to toggle from Django admin without a redeploy:
        MTN_MOMO_COLLECTION_KEY    → Collection product subscription key (Ocp-Apim-Subscription-Key) — shared across currencies
        MTN_MOMO_DISBURSEMENT_KEY  → Disbursement product subscription key — shared across currencies
        MTN_MOMO_USER_ID_LRD/USD   → Collection API user ID — ONE PER CURRENCY (see below)
        MTN_MOMO_API_SECRET_LRD/USD → Collection API key (Basic Auth) — ONE PER CURRENCY

    Dual-currency (LRD + USD): MTN ties the "API User" (user_id + api_secret)
    to a specific account in their partner portal ("Account: LRD" or
    "Account: USD" when creating an API user) — the subscription keys are
    shared, but the API user is not. Every credential-dependent call below
    takes a `currency` argument and resolves the right API user via
    _account_for() — there is no single fixed self.user_id.

    Webhooks: MTN's callback POSTs are not signed (no HMAC, no shared secret
    — unlike Stripe). See mtn_momo_webhook() in payments/views.py — it treats
    the callback purely as a trigger and re-verifies the real status directly
    against MTN's API with our own OAuth credentials instead of trusting
    anything in the inbound payload.
    """

    # MTN MoMo API path segments
    COLLECTION_TOKEN_PATH = 'collection/token/'
    COLLECTION_REQUEST_PATH = 'collection/v1_0/requesttopay'
    DISBURSEMENT_TOKEN_PATH = 'disbursement/token/'
    DISBURSEMENT_TRANSFER_PATH = 'disbursement/v1_0/transfer'

    def __init__(self, gateway_config):
        super().__init__(gateway_config)
        mtn_config = settings.PAYMENT_GATEWAYS.get('mtn_momo', {})
        self.collection_key = mtn_config.get('collection_key', '')        # Collection subscription key
        self.disbursement_key = mtn_config.get('disbursement_key', '')    # Disbursement subscription key
        self._accounts = mtn_config.get('accounts', {})
        self.target_env = 'sandbox' if self.is_sandbox else 'production'

    def _account_for(self, currency: str) -> dict:
        """Resolve the (user_id, api_secret) pair for a specific currency's
        MTN account. Raises ValueError with a clear, actionable message if
        that currency has no API user configured — callers already wrap
        their public methods in try/except and surface this as a normal
        {'success': False, ...} error rather than a raw traceback."""
        key = 'SANDBOX' if self.is_sandbox else (currency or '').upper()

        # TEMPORARY: MTN's partner portal only let us create one API user so
        # far (the USD account) — LRD is suppressed in production until its
        # own API user is provisioned there too. Delete this block (and the
        # LRD entry stays ready to go) once MTN_MOMO_USER_ID_LRD /
        # MTN_MOMO_API_SECRET_LRD are set in backend/.env.
        if not self.is_sandbox and key == 'LRD':
            raise ValueError(
                'MTN MoMo payments in LRD are temporarily unavailable — only the USD '
                'account is provisioned right now. Pay in USD instead.'
            )

        account = self._accounts.get(key) or {}
        if not account.get('user_id') or not account.get('api_secret'):
            if self.is_sandbox:
                raise ValueError('No MTN MoMo sandbox API user configured (MTN_MOMO_USER_ID_SANDBOX / MTN_MOMO_API_SECRET_SANDBOX, or the legacy MTN_MOMO_USER_ID / MTN_MOMO_API_SECRET).')
            raise ValueError(
                f"No MTN MoMo API user configured for the {key} account. Create one in MTN's partner "
                f"portal (Configure -> Create API user, Account: {key}) and set "
                f"MTN_MOMO_USER_ID_{key} / MTN_MOMO_API_SECRET_{key} in backend/.env."
            )
        return account

    # ------------------------------------------------------------------ #
    #  OAuth2 token management                                            #
    # ------------------------------------------------------------------ #

    def _get_access_token(self, currency: str, product: str = 'collection') -> str:
        """
        Fetch (or return a cached) OAuth2 Bearer token for the given product
        AND currency (LRD and USD are different MTN accounts with different
        API users, so they get different tokens). Tokens are cached for 50
        minutes (MTN tokens expire in 60 minutes).
        """
        account = self._account_for(currency)
        cache_currency = 'SANDBOX' if self.is_sandbox else currency.upper()
        cache_key = f'mtn_momo_{self.target_env}_{cache_currency}_{product}_token'
        token = cache.get(cache_key)
        if token:
            return token

        if product == 'collection':
            token_url = self.get_api_url(self.COLLECTION_TOKEN_PATH)
            sub_key = self.collection_key
        else:
            token_url = self.get_api_url(self.DISBURSEMENT_TOKEN_PATH)
            sub_key = self.disbursement_key or self.collection_key

        credentials = base64.b64encode(
            f"{account['user_id']}:{account['api_secret']}".encode()
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

    def _collection_headers(self, currency: str, reference_id: str = None) -> Dict[str, str]:
        token = self._get_access_token(currency, 'collection')
        headers = {
            'Authorization': f'Bearer {token}',
            'Ocp-Apim-Subscription-Key': self.collection_key,
            'X-Target-Environment': self.target_env,
            'Content-Type': 'application/json',
        }
        if reference_id:
            headers['X-Reference-Id'] = reference_id
        return headers

    def _disbursement_headers(self, currency: str, reference_id: str = None) -> Dict[str, str]:
        token = self._get_access_token(currency, 'disbursement')
        sub_key = self.disbursement_key or self.collection_key
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

            # MTN sandbox only accepts EUR — every other currency 400s with
            # NOT_ENOUGH_FUNDS / WRONG_CURRENCY. The local Payment row still
            # stores the user-facing currency (LRD/USD); this override is
            # purely the wire format for sandbox testing. account_currency
            # is what selects credentials (_account_for) — always the real
            # currency, even in sandbox, so a misconfigured USD sandbox
            # account still gets a clear "not configured" error rather than
            # silently borrowing LRD's credentials.
            account_currency = currency
            wire_currency = 'EUR' if self.is_sandbox else currency

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
                'currency': wire_currency,
                'externalId': str(payment_id),   # our Payment UUID → used in webhook lookup
                'payer': {
                    'partyIdType': 'MSISDN',
                    'partyId': formatted_phone,
                },
                'payerMessage': 'Property booking payment',
                'payeeNote': 'Real Estate Platform - Liberia',
            }

            url = self.get_api_url(self.COLLECTION_REQUEST_PATH)
            headers = self._collection_headers(account_currency, reference_id=momo_reference)

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

    def verify_payment(self, transaction_id: str, currency: str = 'LRD') -> Dict[str, Any]:
        """
        Poll the MTN MoMo API for the current status of a transaction.
        transaction_id is the UUID we originally sent as X-Reference-Id.
        currency must match whatever currency the original process_payment()
        call used — it selects which currency's API user authenticates this
        poll (see _account_for).
        """
        try:
            url = self.get_api_url(f'{self.COLLECTION_REQUEST_PATH}/{transaction_id}')
            response = requests.get(
                url,
                headers=self._collection_headers(currency),
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
                headers=self._disbursement_headers(currency, reference_id=reference),
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
        MTN MoMo doesn't sign its callback POSTs — there's no secret or
        signature to check here (unlike Stripe). Always returns False so
        nothing accidentally trusts an inbound payload on its own; real
        authenticity comes from mtn_momo_webhook() re-verifying the status
        directly against MTN's API with our own credentials instead of
        calling this method. Implemented only to satisfy
        PaymentGatewayBase's abstract interface.
        """
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
