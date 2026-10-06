// legalops — /api/legal/ (port of legalops/views.py + urls.py + serializers.py).

import type { Response } from 'express';
import { db } from '../../db/index.js';
import { hasAnyPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { drf } from '../../lib/datetime.js';
import { AllowAny, apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { validate, type FieldSpec } from '../../lib/fields.js';

const DOCUMENT_KEYS: Record<string, string> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
};

async function requireFinance(req: ApiRequest): Promise<boolean> {
  const user = req.user;
  if (!isSuperadminStaff(user)) return false;
  return (await requireDepartment(user, 'finance')) || (await hasAnyPermission(user, 'finances.legal_documents'));
}

type DocRow = {
  id: number; document_key: string; version: string; effective_date: string; summary_of_changes: string;
  body_sections: unknown; published_by_id: number | null; created_at: string;
};

async function serializeDoc(d: DocRow) {
  const u = d.published_by_id === null ? null : await db.selectFrom('users_user').select('username').where('id', '=', d.published_by_id).executeTakeFirst();
  return {
    id: d.id,
    document_key: d.document_key,
    document_key_display: DOCUMENT_KEYS[d.document_key] ?? d.document_key,
    version: d.version,
    effective_date: d.effective_date,
    summary_of_changes: d.summary_of_changes,
    body_sections: d.body_sections,
    published_by: d.published_by_id,
    published_by_username: u ? u.username : null,
    created_at: drf(d.created_at),
  };
}

/** LegalDocument.__str__ */
const docRepr = (d: DocRow) => `${DOCUMENT_KEYS[d.document_key] ?? d.document_key} ${d.version} (effective ${d.effective_date})`;

const DOC_FIELDS: FieldSpec[] = [
  { name: 'document_key', kind: 'choice', required: true, choices: Object.keys(DOCUMENT_KEYS) },
  { name: 'version', kind: 'char', required: true, maxLength: 30 },
  { name: 'effective_date', kind: 'date', required: true },
  { name: 'summary_of_changes', kind: 'char', required: false, allowBlank: true },
  { name: 'body_sections', kind: 'json', required: false },
];

const r = djangoRouter('api/legal/');

r.path('documents/current/', apiView({
  permissions: [AllowAny],
  async GET() {
    const docs = await db.selectFrom('legalops_legaldocument').selectAll()
      .orderBy('document_key').orderBy('effective_date', 'desc').orderBy('created_at', 'desc').execute();
    const latest = new Map<string, DocRow>();
    for (const d of docs) if (!latest.has(d.document_key)) latest.set(d.document_key, d as unknown as DocRow);
    const out = [];
    for (const d of latest.values()) out.push(await serializeDoc(d));
    return out;
  },
}));

r.path('documents/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res: Response) {
    if (!(await requireFinance(req))) return res.status(403).json({ error: 'Finance & Legal access required' });
    let q = db.selectFrom('legalops_legaldocument').selectAll();
    const raw = req.query.document_key;
    const key = raw === undefined ? undefined : Array.isArray(raw) ? String(raw.at(-1)) : String(raw);
    if (key) q = q.where('document_key', '=', key);
    const docs = await q.orderBy('effective_date', 'desc').orderBy('created_at', 'desc').execute();
    const out = [];
    for (const d of docs) out.push(await serializeDoc(d as unknown as DocRow));
    return out;
  },
  async POST(req, res: Response) {
    if (!(await requireFinance(req))) return res.status(403).json({ error: 'Finance & Legal access required' });
    const { errors, values } = await validate(req.body === undefined ? {} : req.body, DOC_FIELDS);
    if (errors) return res.status(400).json(errors);
    // UniqueConstraint(document_key, version) → DRF UniqueTogetherValidator
    const dup = await db.selectFrom('legalops_legaldocument').select('id')
      .where('document_key', '=', values.document_key as string).where('version', '=', values.version as string).executeTakeFirst();
    if (dup) return res.status(400).json({ non_field_errors: ['The fields document_key, version must make a unique set.'] });
    const doc = await db.insertInto('legalops_legaldocument').values({
      document_key: values.document_key as string,
      version: values.version as string,
      effective_date: values.effective_date as string,
      summary_of_changes: (values.summary_of_changes as string | undefined) ?? '',
      body_sections: JSON.stringify('body_sections' in values ? values.body_sections : []),
      published_by_id: req.user!.id,
      created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow() as unknown as DocRow;
    await logAdminAction(req, 'legal_document.publish', { target: auditTarget('LegalDocument', doc.id, docRepr(doc)), reason: doc.summary_of_changes });
    return res.status(201).json(await serializeDoc(doc));
  },
}));
