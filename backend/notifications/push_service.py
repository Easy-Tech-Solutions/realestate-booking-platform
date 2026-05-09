"""
Web Push notification delivery using the VAPID protocol (pywebpush).

Required settings
-----------------
VAPID_PRIVATE_KEY   Base64url-encoded private key (generate once, keep secret)
VAPID_PUBLIC_KEY    Base64url-encoded public key  (send to frontend)
VAPID_CLAIMS_EMAIL  Contact email in the VAPID claims  (e.g. admin@yourdomain.com)

Generate keys once:
    python manage.py generate_vapid_keys
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def _get_vapid_config():
    private_key = getattr(settings, 'VAPID_PRIVATE_KEY', None)
    public_key = getattr(settings, 'VAPID_PUBLIC_KEY', None)
    email = getattr(settings, 'VAPID_CLAIMS_EMAIL', 'admin@homekonet.com')
    return private_key, public_key, email


def send_push_to_user(user, title: str, body: str, data: dict = None, url: str = '/'):
    """
    Send a Web Push notification to every registered browser/device for a user.
    Silently skips if pywebpush or VAPID keys are not configured.
    """
    private_key, _, email = _get_vapid_config()
    if not private_key:
        logger.debug('VAPID_PRIVATE_KEY not set — skipping push for user %s', user.pk)
        return

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning('pywebpush is not installed — push notifications disabled')
        return

    from .models import DeviceToken
    tokens = DeviceToken.objects.filter(user=user)
    if not tokens.exists():
        return

    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url,
        **(data or {}),
    })

    stale_ids = []
    for device in tokens:
        subscription_info = {
            'endpoint': device.endpoint,
            'keys': {
                'p256dh': device.p256dh,
                'auth': device.auth,
            },
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={'sub': f'mailto:{email}'},
            )
        except WebPushException as exc:
            # 410 Gone = subscription expired/revoked; clean it up
            if exc.response is not None and exc.response.status_code in (404, 410):
                stale_ids.append(device.id)
            else:
                logger.warning('Push failed for device %s: %s', device.id, exc)
        except Exception as exc:
            logger.warning('Push failed for device %s: %s', device.id, exc)

    if stale_ids:
        DeviceToken.objects.filter(id__in=stale_ids).delete()
