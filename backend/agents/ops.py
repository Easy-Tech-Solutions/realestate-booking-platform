"""
The Home Konet Operations account — the system user that *owns* agent-sourced
listings on the platform side (so tenant inquiries, messages, and booking
coordination route to Ops, never to the sourcing agent).
"""
from django.conf import settings
from django.contrib.auth import get_user_model

OPS_USERNAME = 'homekonet_ops'


def get_ops_account():
    """Return (creating if needed) the Home Konet Operations system account.

    Kept as a non-login (`is_active=False`), non-privileged (`role='user'`)
    account whose email is the Ops inbox — so notifications addressed to it as
    a listing owner land with Operations. Idempotent.
    """
    User = get_user_model()
    ops_email = getattr(settings, 'OPS_EMAIL', '') or settings.DEFAULT_FROM_EMAIL
    user, _ = User.objects.get_or_create(
        username=OPS_USERNAME,
        defaults={
            'email': ops_email,
            'first_name': 'Home Konet',
            'last_name': 'Operations',
            'is_active': False,
            'role': 'user',
        },
    )
    return user
