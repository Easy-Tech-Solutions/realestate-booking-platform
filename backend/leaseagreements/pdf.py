"""WeasyPrint rendering of the Agreement of Lease HTML template → PDF bytes."""
from django.template.loader import render_to_string


def render_lease_pdf(context: dict) -> bytes:
    # Imported lazily so the rest of the app (and tests that don't render PDFs)
    # don't require WeasyPrint's system libraries to be installed.
    from weasyprint import HTML

    html = render_to_string('leases/agreement_of_lease.html', context)
    return HTML(string=html).write_pdf()
