"""WeasyPrint rendering of the Property Owner Agreement HTML template → PDF bytes."""
from django.template.loader import render_to_string


def render_owner_agreement_pdf(context: dict) -> bytes:
    # Imported lazily so the rest of the app (and tests that don't render PDFs)
    # don't require WeasyPrint's system libraries to be installed.
    from weasyprint import HTML

    html = render_to_string('agreements/property_owner_agreement.html', context)
    return HTML(string=html).write_pdf()
