// inventory — /api/inventory/ (port of inventory/views.py + urls.py).

import { sql, type Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { InventoryListingflag } from '../../db/schema.js';
import { drf, nowPg } from '../../lib/datetime.js';
import { paginate } from '../../lib/drf.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasAnyPermission, hasPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { delayAiScoring } from '../../domain/aiscoring.js';
import { dataGet, dataHas, dataItem, ormPk, parseRequest, pkParam, pyInt, pyStrip, pystr, pyTypeName } from '../listings/drf.js';
import { icontains } from '../listings/filters.js';
import { saveListing } from '../listings/models.js';
import type { ListingRow } from '../listings/serializers.js';
import { createListingFlag, runAllDetectors } from './detection.js';
import { pySetDifference } from './pyset.js';

const r = djangoRouter('api/inventory/');
const view = (opts: Parameters<typeof apiView>[0]) => apiView({ permissions: [IsAuthenticated], ...opts });

const FLAG_TYPES: Record<string, string> = { duplicate: 'Possible duplicate listing', price_anomaly: 'Price far outside normal range', manual: 'Manually flagged' };
const flagStr = (f: { flag_type: string; status: string }) => `${FLAG_TYPES[f.flag_type] ?? f.flag_type} (${f.status})`;
const isTruthy = (v: unknown) => !(v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length));

/** _require_inventory(request) */
async function requireInventory(req: ApiRequest) {
  const u = req.user;
  const ok = isSuperadminStaff(u) && ((await requireDepartment(u, 'inventory')) || (await hasAnyPermission(u, 'listings.availability'))
    || (await hasAnyPermission(u, 'trust_safety.flags')));
  if (!ok) throw new HttpResponseError(403, { error: 'Inventory & Listings access required' });
}

/** InventoryListingSerializer — open_flag_count only when the queryset was annotated (else SkipField). */
async function serializeInventoryListings(rows: (ListingRow & { open_flag_count?: number })[]) {
  const ids = [...new Set(rows.flatMap((l) => [l.owner_id, l.suspended_by_id]).filter((x): x is number => x !== null))];
  const users = ids.length ? await db.selectFrom('users_user').select(['id', 'username', 'email']).where('id', 'in', ids).execute() : [];
  const by = new Map(users.map((u) => [u.id, u]));
  return rows.map((l) => {
    const out: Record<string, unknown> = {
      id: l.id, title: l.title, status: l.status, price: l.price, property_type: l.property_type, city: l.city, state: l.state, country: l.country,
      owner: l.owner_id, owner_username: by.get(l.owner_id)!.username, owner_email: by.get(l.owner_id)!.email,
      deleted_at: drf(l.deleted_at), suspended_by: l.suspended_by_id,
      suspended_by_username: l.suspended_by_id !== null ? by.get(l.suspended_by_id)?.username ?? null : null,
      suspended_at: drf(l.suspended_at), suspension_reason: l.suspension_reason, max_guests: l.max_guests,
      local_registration_number: l.local_registration_number, occupancy_cap: l.occupancy_cap,
    };
    if (l.open_flag_count !== undefined) out.open_flag_count = Number(l.open_flag_count);
    out.created_at = drf(l.created_at);
    out.updated_at = drf(l.updated_at);
    return out;
  });
}

async function serializeFlags(flags: Selectable<InventoryListingflag>[]) {
  const lids = [...new Set(flags.map((f) => f.listing_id).filter((x): x is number => x !== null))];
  const uids = [...new Set(flags.map((f) => f.reviewed_by_id).filter((x): x is number => x !== null))];
  const ls = lids.length ? await db.selectFrom('listings_listing').select(['id', 'title', 'status']).where('id', 'in', lids).execute() : [];
  const us = uids.length ? await db.selectFrom('users_user').select(['id', 'username']).where('id', 'in', uids).execute() : [];
  const lBy = new Map(ls.map((l) => [l.id, l])); const uBy = new Map(us.map((u) => [u.id, u]));
  return flags.map((f) => ({
    id: f.id, listing: f.listing_id,
    listing_title: f.listing_id !== null ? lBy.get(f.listing_id)?.title ?? null : null,
    listing_status: f.listing_id !== null ? lBy.get(f.listing_id)?.status ?? null : null,
    flag_type: f.flag_type, flag_type_display: FLAG_TYPES[f.flag_type] ?? f.flag_type, severity: f.severity, status: f.status,
    details: f.details, ai_score: f.ai_score, ai_rationale: f.ai_rationale, reviewed_by: f.reviewed_by_id,
    reviewed_by_username: f.reviewed_by_id !== null ? uBy.get(f.reviewed_by_id)?.username ?? null : null,
    reviewed_at: drf(f.reviewed_at), review_notes: f.review_notes, created_at: drf(f.created_at),
  }));
}

async function listingOr404(pk: unknown): Promise<ListingRow> {
  const id = pkParam(pk);
  const l = id === null ? undefined : await db.selectFrom('listings_listing').selectAll().where('id', '=', id).executeTakeFirst();
  if (!l) throw notFoundFor('Listing');
  return l;
}

const q1 = (v: unknown) => (Array.isArray(v) ? v[v.length - 1] : v) as string | undefined;

r.path('listings/', view({
  async GET(req) {
    await requireInventory(req);
    const conds = [];
    const status = q1(req.query.status);
    if (status) conds.push(sql`"listings_listing"."status" = ${status}`);
    const search = pyStrip(q1(req.query.search) ?? '');
    if (search) {
      conds.push(sql`(${icontains(sql.ref('listings_listing.title'), search)} OR ${icontains(sql.ref('listings_listing.address'), search)}
        OR ${icontains(sql.ref('listings_listing.city'), search)} OR ${icontains(sql.ref('U.username'), search)} OR ${icontains(sql.ref('U.email'), search)})`);
    }
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
    const having = q1(req.query.flagged) === 'true' ? sql`HAVING COUNT("inventory_listingflag"."id") FILTER (WHERE "inventory_listingflag"."status" = 'open') > 0` : sql``;
    const from = sql`FROM "listings_listing" LEFT OUTER JOIN "inventory_listingflag" ON ("listings_listing"."id" = "inventory_listingflag"."listing_id")
      INNER JOIN "users_user" "U" ON ("listings_listing"."owner_id" = "U"."id") ${where} GROUP BY "listings_listing"."id" ${having}`;
    return paginate(req, { pageSize: 25, pageSizeQueryParam: 'page_size', maxPageSize: 100 },
      async () => Number((await sql<{ n: number }>`SELECT COUNT(*) AS n FROM (SELECT "listings_listing"."id" ${from}) s`.execute(db)).rows[0]!.n),
      async (limit, offset) => serializeInventoryListings((await sql<ListingRow & { open_flag_count: number }>`SELECT "listings_listing".*,
        COUNT("inventory_listingflag"."id") FILTER (WHERE "inventory_listingflag"."status" = 'open') AS "open_flag_count" ${from}
        ORDER BY "listings_listing"."created_at" DESC LIMIT ${limit} OFFSET ${offset}`.execute(db)).rows));
  },
}));

async function suspend(req: ApiRequest, listingId: number, reason: string) {
  return saveListing(listingId, { status: 'suspended', suspended_by_id: req.user!.id, suspended_at: nowPg(), suspension_reason: reason },
    { updateFields: ['status', 'suspended_by', 'suspended_at', 'suspension_reason', 'updated_at'] });
}

r.path('listings/bulk/', view({
  async POST(req, res) {
    await requireInventory(req);
    const { data } = await parseRequest(req, res);
    const action = dataGet(data, 'action');
    let ids = dataGet(data, 'listing_ids');
    if (!isTruthy(ids)) ids = [];
    const reason = pyStrip(pystr(dataGet(data, 'reason', '')));
    if (action !== 'suspend' && action !== 'unsuspend') return res.status(400).json({ error: 'action must be "suspend" or "unsuspend".' });
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'listing_ids (non-empty list) is required.' });
    if (action === 'suspend' && !reason) return res.status(400).json({ error: 'A reason is required to suspend listings.' });
    if (ids.length > 200) return res.status(400).json({ error: 'Bulk actions are capped at 200 listings per request.' });
    const pks = ids.map((x) => ormPk(x)).filter((x): x is number => x !== null);
    const listings = pks.length ? (await sql<ListingRow>`SELECT * FROM "listings_listing" WHERE "listings_listing"."id" IN (${sql.join(pks)})`.execute(db)).rows : [];
    const results: { succeeded: number[]; failed: { listing_id: unknown; error: string }[] } = { succeeded: [], failed: [] };
    const found = new Set(listings.map((l) => BigInt(l.id)));
    if (ids.every((x) => typeof x === 'number' && Number.isInteger(x))) {
      for (const m of pySetDifference(ids.map((x) => BigInt(x as number)), found)) results.failed.push({ listing_id: Number(m), error: 'Not found' });
    } else {
      // non-int members (strings etc.) never equal an int pk — Python set order for those isn't reproducible.
      const seen = new Set<string>();
      for (const x of ids) {
        const k = JSON.stringify(x);
        if (seen.has(k)) continue; seen.add(k);
        if (!(typeof x === 'number' && found.has(BigInt(Math.trunc(x))))) results.failed.push({ listing_id: x, error: 'Not found' });
      }
    }
    for (const l of listings) {
      if (action === 'suspend') { await suspend(req, l.id, reason); results.succeeded.push(l.id); continue; }
      if (l.status !== 'suspended') { results.failed.push({ listing_id: l.id, error: 'Not currently suspended.' }); continue; }
      await saveListing(l.id, { status: 'published' }, { updateFields: ['status', 'updated_at'] });
      results.succeeded.push(l.id);
    }
    await logAdminAction(req, `listing.bulk_${action}`, {
      reason, metadata: { listing_ids: ids, succeeded: results.succeeded, failed: results.failed.map((f) => f.listing_id) },
    });
    return results;
  },
}));

r.path('listings/<int:pk>/suspend/', view({
  async POST(req, res) {
    await requireInventory(req);
    const { data } = await parseRequest(req, res);
    const reason = pyStrip(pystr(dataGet(data, 'reason', '')));
    if (!reason) return res.status(400).json({ error: 'A reason is required to suspend a listing.' });
    const listing = await listingOr404(req.params.pk);
    const saved = await suspend(req, listing.id, reason);
    await logAdminAction(req, 'listing.suspend', { target: auditTarget('Listing', saved.id, saved.title), reason });
    return (await serializeInventoryListings([saved]))[0];
  },
}));

r.path('listings/<int:pk>/unsuspend/', view({
  async POST(req, res) {
    await requireInventory(req);
    const listing = await listingOr404(req.params.pk);
    if (listing.status !== 'suspended') return res.status(400).json({ error: 'Listing is not currently suspended.' });
    const saved = await saveListing(listing.id, { status: 'published' }, { updateFields: ['status', 'updated_at'] });
    await logAdminAction(req, 'listing.unsuspend', { target: auditTarget('Listing', saved.id, saved.title) });
    return (await serializeInventoryListings([saved]))[0];
  },
}));

r.path('listings/<int:pk>/compliance/', view({
  async PATCH(req, res) {
    if (!(await hasPermission(req.user, 'listings.compliance', 'update'))) return res.status(403).json({ error: 'listings.compliance access required' });
    const listing = await listingOr404(req.params.pk);
    const { data } = await parseRequest(req, res);
    let reg = listing.local_registration_number;
    let cap = listing.occupancy_cap;
    if (dataHas(data, 'local_registration_number')) reg = pyStrip(pystr(dataItem(data, 'local_registration_number')));
    if (dataHas(data, 'occupancy_cap')) {
      const raw = dataItem(data, 'occupancy_cap');
      if (raw === null || raw === '') cap = null;
      else if (typeof raw === 'boolean') cap = raw ? 1 : 0;
      else if (typeof raw === 'number') cap = Math.trunc(raw);
      else if (typeof raw === 'string' && pyInt(raw) !== null) cap = Number(pyInt(raw));
      else throw new TypeError(`int() argument must be a string or a number, not '${pyTypeName(raw)}'`);
      if (cap !== null && listing.max_guests > cap) {
        return res.status(400).json({ error: `This listing currently allows ${listing.max_guests} guests, above the proposed cap of ${cap}. Lower max_guests first (as the host) or raise the cap.` });
      }
    }
    const saved = await saveListing(listing.id, { local_registration_number: reg, occupancy_cap: cap },
      { updateFields: ['local_registration_number', 'occupancy_cap', 'updated_at'] });
    await logAdminAction(req, 'listing.compliance_update', {
      target: auditTarget('Listing', saved.id, saved.title), metadata: { local_registration_number: reg, occupancy_cap: cap },
    });
    return (await serializeInventoryListings([saved]))[0];
  },
}));

r.path('flags/', view({
  async GET(req) {
    await requireInventory(req);
    const raw = q1(req.query.status);
    const st = raw === undefined ? 'open' : raw;
    let q = db.selectFrom('inventory_listingflag').selectAll();
    if (st && st !== 'all') q = q.where('status', '=', st);
    return serializeFlags(await q.orderBy('created_at', 'desc').execute());
  },
}));

r.path('flags/scan/', view({
  async POST(req) {
    await requireInventory(req);
    const results = await runAllDetectors();
    const created = Object.values(results).reduce((a, v) => a + v.length, 0);
    await logAdminAction(req, 'listing_flag.scan', { reason: '', metadata: { created } });
    return { created, by_detector: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])) };
  },
}));

r.path('flags/manual/', view({
  async POST(req, res) {
    await requireInventory(req);
    const { data } = await parseRequest(req, res);
    const listingId = dataGet(data, 'listing');
    const details = pyStrip(pystr(dataGet(data, 'details', '')));
    const severity = dataGet(data, 'severity', 'medium');
    if (!isTruthy(listingId) || !details) return res.status(400).json({ error: 'listing and details are required' });
    const pk = ormPk(listingId);
    const listing = pk === null ? undefined : await db.selectFrom('listings_listing').select('id').where('id', '=', pk).executeTakeFirst();
    if (!listing) throw notFoundFor('Listing');
    const flag = await createListingFlag({ listing_id: listing.id, flag_type: 'manual', severity: severity === null ? (null as never) : pystr(severity), details });
    await delayAiScoring('score_listing_flag_task', flag.id);
    await logAdminAction(req, 'listing_flag.create', { target: auditTarget('ListingFlag', flag.id, flagStr(flag)), reason: details });
    return res.status(201).json((await serializeFlags([flag]))[0]);
  },
}));

r.path('flags/<int:pk>/review/', view({
  async POST(req, res) {
    await requireInventory(req);
    const pk = pkParam(req.params.pk);
    const flag = pk === null ? undefined : await db.selectFrom('inventory_listingflag').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!flag) throw notFoundFor('ListingFlag');
    const { data } = await parseRequest(req, res);
    const decision = dataGet(data, 'status');
    if (decision !== 'dismissed' && decision !== 'confirmed') return res.status(400).json({ error: 'status must be "dismissed" or "confirmed"' });
    const notes = dataGet(data, 'notes', '');
    const saved = await db.updateTable('inventory_listingflag').set({
      status: decision, review_notes: notes === null ? (null as never) : pystr(notes), reviewed_by_id: req.user!.id, reviewed_at: nowPg(),
    }).where('id', '=', flag.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'listing_flag.review', {
      target: auditTarget('ListingFlag', saved.id, flagStr(saved)), reason: isTruthy(notes) ? pystr(notes) : '', metadata: { decision },
    });
    return (await serializeFlags([saved]))[0];
  },
}));
