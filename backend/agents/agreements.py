"""
Agent Agreement — personalized PDF generation. Mirrors
hostapplications.agreements: generated on final approval, emailed to the new
agent, and downloadable from their dashboard.
"""

from django.core.files.base import ContentFile
from django.utils import timezone

from .models import AGENT_AGREEMENT_VERSION, AGENT_AGREEMENT_EFFECTIVE_DATE

# The platform is administered from Monrovia, Montserrado — used as the default
# venue in the generated agreement's preamble (matches the frontend page).
DEFAULT_CITY = 'Monrovia'
DEFAULT_COUNTY = 'Montserrado'


def build_agent_agreement_context(application) -> dict:
    """The values filled into the agent agreement template for one applicant."""
    today = timezone.localdate()
    return {
        'agent_full_name': application.full_name,
        'city':            DEFAULT_CITY,
        'county':          DEFAULT_COUNTY,
        'day':             today.day,
        'month':           today.strftime('%B'),
        'year':            today.year,
        'version':         AGENT_AGREEMENT_VERSION,
        'effective_date':  AGENT_AGREEMENT_EFFECTIVE_DATE,
    }


def generate_and_store_agent_agreement(application):
    """Render the personalized Agent Agreement PDF and store it on the
    application. Returns the application."""
    from .pdf import render_agent_agreement_pdf

    context = build_agent_agreement_context(application)
    pdf_bytes = render_agent_agreement_pdf(context)
    filename = f'agent_agreement_{application.pk}_v{AGENT_AGREEMENT_VERSION}.pdf'
    application.agreement_document.save(filename, ContentFile(pdf_bytes), save=False)
    application.save(update_fields=['agreement_document', 'updated_at'])
    return application
