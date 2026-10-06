// hostapplications.pdf.render_owner_agreement_pdf — templates/agreements/property_owner_agreement.html
// rendered to PDF (WeasyPrint in Django, headless Chromium here: the shared lib/pdf.ts renderer).

import { htmlToPdf } from '../../lib/pdf.js';
import { renderToString } from '../../lib/templates.js';

/** render_owner_agreement_pdf(context) → PDF bytes */
export function renderOwnerAgreementPdf(context: Record<string, unknown>): Promise<Buffer> {
  return htmlToPdf(renderToString('agreements/property_owner_agreement.html', context));
}
