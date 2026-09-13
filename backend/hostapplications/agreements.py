"""
Property Owner Agreement — version metadata and acceptance helpers.

The current version lives here as the single source of truth. When the
agreement text changes, bump CURRENT_AGREEMENT_VERSION (and update the
effective date + the frontend agreement page). Bumping the version means every
host must accept again the next time they try to list a property; previously
accepted versions are never re-prompted.
"""

from django.core.files.base import ContentFile
from django.utils import timezone

from .models import AgreementAcceptance

AGREEMENT_KEY = AgreementAcceptance.AGREEMENT_PROPERTY_OWNER
CURRENT_AGREEMENT_VERSION = '2.0'
AGREEMENT_EFFECTIVE_DATE = '2026-09-12'
AGREEMENT_TITLE = 'Property Owner Listing Agreement'

# The property is administered from Monrovia, Montserrado — used as the default
# venue in the generated agreement's preamble (see the frontend page + template).
DEFAULT_CITY = 'Monrovia'
DEFAULT_COUNTY = 'Montserrado'


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


# ---------------------------------------------------------------------------
# Personalized PDF — generated on final approval, emailed to the new host, and
# downloadable from their dashboard. Mirrors the leaseagreements PDF flow.
# ---------------------------------------------------------------------------

def build_owner_agreement_context(application) -> dict:
    """The values filled into the agreement template for one applicant."""
    today = timezone.localdate()
    return {
        'owner_full_name': application.full_name,
        'city':            DEFAULT_CITY,
        'county':          DEFAULT_COUNTY,
        'day':             today.day,
        'month':           today.strftime('%B'),
        'year':            today.year,
        'version':         CURRENT_AGREEMENT_VERSION,
        'effective_date':  AGREEMENT_EFFECTIVE_DATE,
    }


def generate_and_store_owner_agreement(application):
    """Render the personalized Property Owner Agreement PDF and store it on the
    application. Idempotent-ish: always regenerates for the current version so a
    re-run reflects the latest template/version. Returns the application."""
    from .pdf import render_owner_agreement_pdf

    context = build_owner_agreement_context(application)
    pdf_bytes = render_owner_agreement_pdf(context)
    filename = f'property_owner_agreement_{application.pk}_v{CURRENT_AGREEMENT_VERSION}.pdf'
    application.agreement_document.save(filename, ContentFile(pdf_bytes), save=False)
    application.agreement_version = CURRENT_AGREEMENT_VERSION
    application.save(update_fields=['agreement_document', 'agreement_version', 'updated_at'])
    return application
