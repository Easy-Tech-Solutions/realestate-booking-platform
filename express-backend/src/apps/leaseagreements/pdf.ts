// leaseagreements.pdf.render_lease_pdf — templates/leases/agreement_of_lease.html
// rendered to PDF (WeasyPrint in Django, headless Chromium here: lib/pdf.ts).

import { htmlToPdf } from '../../lib/pdf.js';
import { renderToString } from '../../lib/templates.js';

/** render_lease_pdf(context) → PDF bytes */
export function renderLeasePdf(context: Record<string, unknown>): Promise<Buffer> {
  return htmlToPdf(renderToString('leases/agreement_of_lease.html', context));
}
