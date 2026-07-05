"""
Structured logging helpers for HomeKonet.

Usage
-----
from realestate_backend.app_logging import log_activity, log_transaction

# Record a user action (goes to activity.log + application.log)
log_activity(request, 'booking_created', resource_type='booking', resource_id=booking.id)

# Record a payment event (goes to transactions.log + application.log)
log_transaction('payment_initiated', user_id=user.id, booking_id=booking.id, amount=50.00)

Security
--------
Never pass passwords, raw tokens, or payment card data via **extra.
Amounts are safe to log; card numbers and CVVs are not.
"""
import logging

_activity_log = logging.getLogger('homekonet.activity')
_transaction_log = logging.getLogger('homekonet.transactions')


def _get_ip(request) -> str:
    """Extract the real client IP, honouring X-Forwarded-For behind a proxy."""
    if not request:
        return ''
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '')


def log_activity(
    request,
    action: str,
    *,
    resource_type: str = None,
    resource_id=None,
    user=None,
    **extra,
) -> None:
    """Emit one activity-log entry.

    Parameters
    ----------
    request       : Django HttpRequest (or None for background tasks)
    action        : snake_case event name, e.g. 'user_login', 'booking_created'
    resource_type : type of the primary object involved, e.g. 'booking'
    resource_id   : PK of that object
    user          : override the request.user (useful when the user was just
                    created and is not yet on the request)
    **extra       : additional context key/value pairs (no sensitive data)
    """
    if user is None and request is not None:
        u = getattr(request, 'user', None)
        if u is not None and getattr(u, 'is_authenticated', False):
            user = u

    _activity_log.info(
        action,
        extra={
            'action': action,
            'user_id': user.id if user else None,
            'user_email': user.email if user else None,
            'resource_type': resource_type,
            'resource_id': resource_id,
            'ip': _get_ip(request),
            **extra,
        },
    )


def log_transaction(
    action: str,
    *,
    user_id=None,
    booking_id=None,
    amount=None,
    currency: str = None,
    payment_method: str = None,
    gateway: str = None,
    tx_ref: str = None,
    gateway_status: str = None,
    **extra,
) -> None:
    """Emit one transaction-log entry.

    Parameters
    ----------
    action         : snake_case event name, e.g. 'payment_initiated'
    user_id        : PK of the paying user
    booking_id     : PK of the associated booking
    amount         : monetary amount (stored as string to avoid float drift)
    currency       : ISO 4217 code, e.g. 'USD'
    payment_method : 'stripe' | 'mtn_momo' | etc.
    gateway        : gateway identifier
    tx_ref         : gateway-side transaction / intent reference
    gateway_status : status string returned by the gateway
    **extra        : additional context (no card numbers, no raw keys)
    """
    _transaction_log.info(
        action,
        extra={
            'action': action,
            'user_id': user_id,
            'booking_id': booking_id,
            'amount': str(amount) if amount is not None else None,
            'currency': currency,
            'payment_method': payment_method,
            'gateway': gateway,
            'tx_ref': tx_ref,
            'gateway_status': gateway_status,
            **extra,
        },
    )
