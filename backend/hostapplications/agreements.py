"""
Property Owner Agreement — version metadata and acceptance helpers.

The current version lives here as the single source of truth. When the
agreement text changes, bump CURRENT_AGREEMENT_VERSION (and update the
effective date + the frontend agreement page). Bumping the version means every
host must accept again the next time they try to list a property; previously
accepted versions are never re-prompted.
"""

from .models import AgreementAcceptance

AGREEMENT_KEY = AgreementAcceptance.AGREEMENT_PROPERTY_OWNER
CURRENT_AGREEMENT_VERSION = '1.0'
AGREEMENT_EFFECTIVE_DATE = '2026-07-07'
AGREEMENT_TITLE = 'Property Owner Listing Agreement'


def has_accepted_current(user) -> bool:
    """True if the user has accepted the current agreement version."""
    if not user or not user.is_authenticated:
        return False
    return AgreementAcceptance.objects.filter(
        user=user, agreement=AGREEMENT_KEY, version=CURRENT_AGREEMENT_VERSION,
    ).exists()


def record_acceptance(user, ip_address=None) -> AgreementAcceptance:
    """
    Record that the user accepted the current version. Idempotent per version —
    re-accepting the same version returns the existing (first) acceptance so the
    original timestamp is preserved for audit.
    """
    acceptance, _ = AgreementAcceptance.objects.get_or_create(
        user=user,
        agreement=AGREEMENT_KEY,
        version=CURRENT_AGREEMENT_VERSION,
        defaults={'ip_address': ip_address},
    )
    return acceptance


def latest_acceptance(user):
    """The user's most recent acceptance of this agreement (any version), or None."""
    if not user or not user.is_authenticated:
        return None
    return (
        AgreementAcceptance.objects.filter(user=user, agreement=AGREEMENT_KEY)
        .order_by('-accepted_at')
        .first()
    )
