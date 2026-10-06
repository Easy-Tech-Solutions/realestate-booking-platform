// reports — /api/reports/ (port of reports/views.py + serializers.py + urls.py).

import type { Request, Response } from 'express';
import { imageSize } from 'image-size';
import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import type { ReportsReport } from '../../db/schema.js';
import {
  notifyReportSubmitted, notifyReportUpdated, REPORT_CONTENT_TYPE_LABELS, REPORT_STATUS_LABELS, REPORT_TYPE_LABELS, reportPostSave,
} from '../../domain/notifications.js';
import { hasAnyPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { drf } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import { saveUpload } from '../../lib/upload.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { charField, choiceField, FieldErr, pkRelatedField } from '../suspensions/serializers.js';
import {
  dget, isFile, limitOffset, pkValue, pyBool, pySetDifference, pyStr, pyStrip, pyTypeName, qp, requestData, setKey, strStrip, type UploadedFile,
} from '../users/request.js';

type Report = Selectable<ReportsReport>;

const CONTENT_TYPES = ['user', 'listing', 'review', 'message'];
const REPORT_TYPES = ['scam', 'fake_listing', 'inappropriate_content', 'harassment', 'wrong_info', 'other'];
const STATUSES = ['pending', 'under_review', 'resolved', 'dismissed'];
const FK_MAP: Record<string, string> = { user: 'reported_user', listing: 'reported_listing', review: 'reported_review', message: 'reported_message' };
const FK_TABLE = { reported_user: 'users_user', reported_listing: 'listings_listing', reported_review: 'listings_review', reported_message: 'messaging_message' } as const;

/** _require_support */
async function requireSupport(req: ApiRequest): Promise<boolean> {
  const u = req.user;
  if (!isSuperadminStaff(u)) return false;
  return (await requireDepartment(u, 'support')) || (await hasAnyPermission(u, 'customer_support.disputes'));
}
const forbidden = (res: Response) => res.status(403).json({ detail: 'Admin access required.' });
const notFound = (res: Response) => res.status(404).json({ detail: 'Not found.' });

/** ReportSerializer(report, context={'request': req}) */
async function serializeReport(req: Request, r: Report) {
  const user = async (id: number | null) => (id === null ? undefined : db.selectFrom('users_user').selectAll().where('id', '=', id).executeTakeFirst());
  const reporter = await user(r.reporter_id);
  const reported = await user(r.reported_user_id);
  const resolvedBy = await user(r.resolved_by_id);
  const escalatedBy = await user(r.escalated_by_id);
  const listing = r.reported_listing_id === null ? undefined
    : await db.selectFrom('listings_listing').select('title').where('id', '=', r.reported_listing_id).executeTakeFirst();
  return {
    id: r.id,
    reporter_username: reporter?.username,
    content_type: r.content_type, content_type_display: REPORT_CONTENT_TYPE_LABELS[r.content_type] ?? r.content_type,
    reported_user: r.reported_user_id,
    reported_user_name: reported ? (`${reported.first_name} ${reported.last_name}`.trim() || reported.username) : null,
    reported_listing: r.reported_listing_id,
    reported_listing_title: listing ? listing.title : null,
    reported_review: r.reported_review_id,
    reported_message: r.reported_message_id,
    report_type: r.report_type, report_type_display: REPORT_TYPE_LABELS[r.report_type] ?? r.report_type,
    description: r.description, owner_name: r.owner_name,
    screenshot_url: r.screenshot ? fileUrl(req, r.screenshot) : null,
    status: r.status, status_display: REPORT_STATUS_LABELS[r.status] ?? r.status,
    admin_notes: r.admin_notes,
    resolved_by_username: resolvedBy ? resolvedBy.username : null,
    escalated_at: drf(r.escalated_at as unknown as string | null),
    escalated_by_username: escalatedBy ? escalatedBy.username : null,
    escalation_notes: r.escalation_notes,
    resolved_at: drf(r.resolved_at as unknown as string | null),
    created_at: drf(r.created_at as unknown as string),
    updated_at: drf(r.updated_at as unknown as string),
  };
}

/** DRF ImageField validation (FileField checks, then the Pillow-backed image check). */
function imageField(v: unknown): UploadedFile | null {
  if (v === null || v === '') return null;
  if (!isFile(v)) throw new FieldErr('The submitted data was not a file. Check the encoding type on the form.');
  if (!v.name) throw new FieldErr('No filename could be determined.');
  if (!v.size) throw new FieldErr('The submitted file is empty.');
  try { imageSize(v.buffer); } catch {
    throw new FieldErr('Upload a valid image. The file you uploaded was either not an image or a corrupted image.');
  }
  return v;
}

// ---- Report model state transitions (+ the notifications.signals report hooks) --------------

async function saveReport(id: number, set: Record<string, unknown>, oldStatus: string): Promise<Report> {
  const row = await db.updateTable('reports_report').set(set as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  await reportPostSave(row as never, { created: false, oldStatus });
  return row;
}
/** Report.resolve / dismiss */
async function closeReport(r: Report, status: string, adminId: number, notes: string) {
  const set: Record<string, unknown> = { status, resolved_by_id: adminId, resolved_at: new Date(), updated_at: new Date() };
  if (notes) set.admin_notes = notes;
  return saveReport(r.id, set, r.status);
}
/** Report.mark_under_review (+ optional admin_notes save) */
async function markUnderReview(r: Report, adminId: number, notes: string) {
  let row = await saveReport(r.id, { status: 'under_review', resolved_by_id: adminId, updated_at: new Date() }, r.status);
  if (notes) row = await saveReport(r.id, { admin_notes: notes }, row.status);
  return row;
}

const r = djangoRouter('api/reports/');

r.path('', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    let q = db.selectFrom('reports_report').selectAll().where('reporter_id', '=', req.user!.id);
    const st = qp(req, 'status');
    if (st) q = q.where('status', '=', st);
    const rows = await q.orderBy('created_at', 'desc').execute();
    const out = [];
    for (const x of rows) out.push(await serializeReport(req, x));
    return out;
  },
  async POST(req, res) {
    const { data } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data) || isFile(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    const d = data as Record<string, unknown>;
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);
    const errors: Record<string, string[]> = {};
    const vals: Record<string, any> = {};
    const field = async (name: string, fn: () => unknown | Promise<unknown>) => {
      try { const v = await fn(); if (v !== undefined) vals[name] = v; } catch (e) {
        if (e instanceof FieldErr) errors[name] = [e.message]; else throw e;
      }
    };
    const required = (k: string) => { if (!has(k)) throw new FieldErr('This field is required.'); };
    await field('content_type', () => { required('content_type'); return choiceField(d.content_type, CONTENT_TYPES); });
    for (const fk of ['reported_user', 'reported_listing', 'reported_review', 'reported_message'] as const) {
      await field(fk, async () => {
        if (!has(fk)) return undefined;
        const row = await pkRelatedField(d[fk], FK_TABLE[fk], true);
        if (fk === 'reported_user' && row && row.id === req.user!.id) throw new FieldErr('You cannot report yourself.');
        return row;
      });
    }
    await field('report_type', () => { required('report_type'); return choiceField(d.report_type, REPORT_TYPES); });
    await field('description', () => { required('description'); return charField(d.description); });
    await field('owner_name', () => (has('owner_name') ? charField(d.owner_name, { allowBlank: true, maxLength: 255 }) : undefined));
    await field('screenshot', () => (has('screenshot') ? imageField(d.screenshot) : undefined));
    if (Object.keys(errors).length) return res.status(400).json(errors);

    // validate(attrs)
    const requiredFk = FK_MAP[vals.content_type]!;
    const hasFk = pyBool(vals[requiredFk]);
    const hasContext = !!pyStrip(vals.owner_name ?? '') || !!vals.screenshot;
    if (!hasFk && !hasContext) {
      return res.status(400).json({ non_field_errors: ['Please provide either the listing owner name / screenshot, or a direct reference to the reported content.'] });
    }
    const fkId = (k: string) => (k === requiredFk && vals[k] ? (vals[k] as { id: number }).id : null);
    const screenshot = vals.screenshot ? await saveUpload('reports/screenshots/', vals.screenshot.name, vals.screenshot.buffer) : '';
    const now = new Date();
    const report = await db.insertInto('reports_report').values({
      reporter_id: req.user!.id, content_type: vals.content_type,
      reported_user_id: fkId('reported_user'), reported_listing_id: fkId('reported_listing'),
      reported_review_id: fkId('reported_review'), reported_message_id: fkId('reported_message'),
      report_type: vals.report_type, description: vals.description, owner_name: vals.owner_name ?? '', screenshot,
      status: 'pending', admin_notes: '', resolved_by_id: null, resolved_at: null, escalated_at: null, escalated_by_id: null,
      escalation_notes: '', created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    try { await notifyReportSubmitted(report as never); } catch { /* never break submission */ }
    return res.status(201).json(await serializeReport(req, report));
  },
}));

async function reportByPath(req: Request): Promise<Report | undefined> {
  const id = pkValue(String(req.params.pk));
  return id === null ? undefined : db.selectFrom('reports_report').selectAll().where('id', '=', id).executeTakeFirst();
}

r.path('<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const report = await reportByPath(req);
    if (!report) return notFound(res);
    if (report.reporter_id !== req.user!.id && !(await requireSupport(req))) return notFound(res);
    return serializeReport(req, report);
  },
}));

r.path('admin/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireSupport(req))) return forbidden(res);
    let q = db.selectFrom('reports_report').selectAll();
    const st = qp(req, 'status'); const ty = qp(req, 'report_type'); const ct = qp(req, 'content_type');
    if (st) q = q.where('status', '=', st);
    if (ty) q = q.where('report_type', '=', ty);
    if (ct) q = q.where('content_type', '=', ct);
    const { limit, offset } = limitOffset(req);
    const total = Number((await q.clearSelect().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
    const rows = await q.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
    const results = [];
    for (const x of rows) results.push(await serializeReport(req, x));
    return { count: total, limit, offset, results };
  },
}));

r.path('admin/stats/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireSupport(req))) return forbidden(res);
    const counts = Object.fromEntries((await sql<{ k: string; n: string }>`SELECT status AS k, count(id) AS n FROM reports_report GROUP BY status`.execute(db)).rows.map((x) => [x.k, Number(x.n)]));
    const total = Number((await sql<{ n: string }>`SELECT count(*) AS n FROM reports_report`.execute(db)).rows[0]!.n);
    return {
      total, pending: counts.pending ?? 0, under_review: counts.under_review ?? 0, resolved: counts.resolved ?? 0, dismissed: counts.dismissed ?? 0,
    };
  },
}));

r.path('admin/bulk/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireSupport(req))) return forbidden(res);
    const { data } = await requestData(req, res);
    const rawIds = dget(data, 'report_ids');
    const ids = pyBool(rawIds) ? rawIds : [];
    const newStatus = dget(data, 'status');
    const notes = strStrip(dget(data, 'admin_notes', ''));
    if (newStatus !== 'resolved' && newStatus !== 'dismissed' && newStatus !== 'under_review') {
      return res.status(400).json({ detail: 'status must be "resolved", "dismissed", or "under_review".' });
    }
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ detail: 'report_ids (non-empty list) is required.' });
    if (ids.length > 200) return res.status(400).json({ detail: 'Bulk actions are capped at 200 reports per request.' });

    const results: { succeeded: number[]; failed: { report_id: unknown; error: string }[] } = { succeeded: [], failed: [] };
    const pks = ids.filter((v) => v !== null).map((v) => pkValue(v)).filter((v): v is number => v !== null);
    const keys = ids.map(setKey);
    const original = new Map(ids.map((v, i) => [keys[i]!, v]));
    // Report.Meta.ordering = ['-created_at']
    const reports = pks.length ? await db.selectFrom('reports_report').selectAll().where('id', 'in', pks).orderBy('created_at', 'desc').execute() : [];
    for (const missing of pySetDifference(keys, reports.map((x) => x.id))) results.failed.push({ report_id: original.get(missing), error: 'Not found' });
    for (const report of reports) {
      try {
        if (newStatus === 'under_review') await markUnderReview(report, req.user!.id, notes);
        else await closeReport(report, newStatus, req.user!.id, notes);
        results.succeeded.push(report.id);
      } catch (e) {
        results.failed.push({ report_id: report.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await logAdminAction(req, `report.bulk_${newStatus}`, {
      reason: notes, metadata: { report_ids: ids, succeeded: results.succeeded, failed: results.failed.map((f) => f.report_id) },
    });
    return results;
  },
}));

r.path('admin/<int:pk>/status/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireSupport(req))) return forbidden(res);
    const report = await reportByPath(req);
    if (!report) return notFound(res);
    const { data } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data) || isFile(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    const d = data as Record<string, unknown>;
    const errors: Record<string, string[]> = {};
    let status: string | undefined; let notes: string | undefined;
    if (Object.prototype.hasOwnProperty.call(d, 'status')) {
      try {
        const v = choiceField(d.status, STATUSES)!;
        if (!['under_review', 'resolved', 'dismissed'].includes(v)) throw new FieldErr('Status must be one of: under_review, resolved, dismissed.');
        status = v;
      } catch (e) { if (e instanceof FieldErr) errors.status = [e.message]; else throw e; }
    }
    if (Object.prototype.hasOwnProperty.call(d, 'admin_notes')) {
      try { notes = charField(d.admin_notes, { allowBlank: true })!; } catch (e) { if (e instanceof FieldErr) errors.admin_notes = [e.message]; else throw e; }
    }
    if (Object.keys(errors).length) return res.status(400).json(errors);

    const newStatus = status ?? report.status;
    const n = notes ?? '';
    const oldStatus = report.status;
    let row: Report;
    if (newStatus === 'resolved' || newStatus === 'dismissed') row = await closeReport(report, newStatus, req.user!.id, n);
    else if (newStatus === 'under_review') row = await markUnderReview(report, req.user!.id, n);
    else row = await saveReport(report.id, { status: newStatus, updated_at: new Date() }, oldStatus);
    if (newStatus !== oldStatus) {
      try { await notifyReportUpdated(row as never); } catch { /* swallowed */ }
    }
    return serializeReport(req, row);
  },
}));

r.path('admin/<int:pk>/escalate/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireSupport(req))) return forbidden(res);
    const report = await reportByPath(req);
    if (!report) return notFound(res);
    const { data } = await requestData(req, res);
    const notes = strStrip(dget(data, 'notes', ''));
    const row = await saveReport(report.id, { escalated_at: new Date(), escalated_by_id: req.user!.id, escalation_notes: notes, updated_at: new Date() }, report.status);
    const reporter = await db.selectFrom('users_user').select('username').where('id', '=', row.reporter_id).executeTakeFirstOrThrow();
    await logAdminAction(req, 'report.escalate', {
      target: auditTarget('Report', row.id, `Report #${row.id} [${row.report_type}] by ${reporter.username} — ${row.status}`), reason: notes,
    });
    return serializeReport(req, row);
  },
}));

void pyStr;
