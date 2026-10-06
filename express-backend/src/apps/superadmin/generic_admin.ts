// superadmin.generic_admin — whitelist registry + per-model ModelSerializer
// equivalents + the list/create and detail views (port of registry.py,
// registrations.py, serializers.py and views.py).

import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { sql, type Expression, type SqlBool } from 'kysely';
import { db } from '../../db/index.js';
import { hasPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction } from '../../domain/superadmin.js';
import { pyStr } from '../../domain/notifications.js';
import { drf } from '../../lib/datetime.js';
import { paginate } from '../../lib/drf.js';
import { NotFound, notFoundFor } from '../../lib/errors.js';
import type { ApiRequest } from '../../lib/view.js';
import { dget, pkValue, pyStrip, qp, requestData } from '../users/request.js';
import { FieldError, validate, type FieldSpec } from '../../lib/fields.js';

type Row = Record<string, any>;

interface ModelConfig {
  table: string;
  /** model._meta.object_name (get_object_or_404 message) */
  objectName: string;
  resource: string;
  auditLabel: string;
  /** model field name → column (only where they differ) */
  searchFields: string[];
  filterable: Record<string, 'bool' | 'int'>;
  orderingFields: string[];
  defaultOrdering: string;
  readOnly?: boolean;
  /** ModelSerializer writable fields (declaration order). `self` is the instance being updated (null on create). */
  specs(instance: Row | null, initialData: Record<string, unknown>): FieldSpec[];
  represent(row: Row): Promise<Record<string, unknown>> | Record<string, unknown>;
  repr(row: Row): string;
  /** Model(**validated_data).save() on create: defaults + save() overrides + auto fields. */
  createRow(values: Record<string, unknown>): Promise<Row> | Row;
  /** instance.save() on update: save() overrides + auto_now. */
  beforeUpdate?(row: Row): Promise<void> | void;
}

const SENSITIVE = ['secret', 'password', 'token', 'api_key', 'private_key'];
const REGISTRY = new Map<string, ModelConfig>();

function register(key: string, config: ModelConfig, fields: string[], allowSensitive = false) {
  if (!allowSensitive) {
    for (const f of fields) {
      if (SENSITIVE.some((s) => f.toLowerCase().includes(s))) throw new Error(`generic_admin.register('${key}'): field '${f}' looks sensitive.`);
    }
  }
  REGISTRY.set(key, config);
}

const UINT = { minValue: 0, maxValue: 2147483647 };
const USMALL = { minValue: 0, maxValue: 32767 };
const json = (v: unknown) => JSON.stringify(v);

// --- registrations.py ----------------------------------------------------------------

async function listingsWithSlug(slug: string): Promise<number> {
  const r = await db.selectFrom('listings_listing').select(sql<number>`count(*)::int`.as('n')).where('property_type', '=', slug).executeTakeFirstOrThrow();
  return r.n;
}

register('property_category', {
  table: 'listings_propertycategory', objectName: 'PropertyCategory', resource: 'listings.categories', auditLabel: 'property_category',
  searchFields: ['name', 'slug'], filterable: { is_active: 'bool' },
  orderingFields: ['sort_order', 'name', 'id'], defaultOrdering: 'sort_order',
  specs: (instance, initial) => [
    { name: 'name', kind: 'char', maxLength: 80, unique: { table: 'listings_propertycategory', column: 'name', message: 'property category with this name already exists.' } },
    {
      name: 'slug', kind: 'slug', maxLength: 100, unique: { table: 'listings_propertycategory', column: 'slug', message: 'property category with this slug already exists.' },
      async validate(value) {
        if (instance !== null && value !== instance.slug) {
          const count = await listingsWithSlug(instance.slug);
          const force = ['true', '1', 'yes'].includes(pyStr(dget(initial, 'force', '')).toLowerCase());
          if (count && !force) {
            throw new FieldError(
              `${count} listing(s) are tagged with the current slug "${instance.slug}" — `
              + 'renaming it will orphan their category reference (they store the slug as plain '
              + 'text, not a link to this category). Pass force=true to rename anyway.',
            );
          }
        }
        return value;
      },
    },
    { name: 'is_active', kind: 'bool', required: false },
    { name: 'sort_order', kind: 'int', required: false, ...UINT },
  ],
  async represent(r) {
    return { id: r.id, name: r.name, slug: r.slug, is_active: r.is_active, sort_order: r.sort_order, listings_count: await listingsWithSlug(r.slug) };
  },
  repr: (r) => r.name,
  async createRow(v) {
    const now = new Date();
    return db.insertInto('listings_propertycategory').values({
      name: v.name as string, slug: v.slug as string, is_active: (v.is_active ?? true) as boolean, sort_order: (v.sort_order ?? 0) as number,
      created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
  },
  beforeUpdate(r) { r.updated_at = new Date(); },
}, ['id', 'name', 'slug', 'is_active', 'sort_order', 'listings_count']);

register('currency', {
  table: 'payments_currency', objectName: 'Currency', resource: 'finances.currencies', auditLabel: 'currency',
  searchFields: ['code', 'name'], filterable: { is_active: 'bool' },
  orderingFields: ['code', 'exchange_rate_to_usd'], defaultOrdering: 'code',
  readOnly: true,
  specs: () => [],
  represent: (r) => ({ id: r.id, code: r.code, name: r.name, symbol: r.symbol, exchange_rate_to_usd: r.exchange_rate_to_usd, is_active: r.is_active }),
  repr: (r) => `${r.code} - ${r.name}`,
  createRow: () => { throw new Error('read-only'); },
}, ['id', 'code', 'name', 'symbol', 'exchange_rate_to_usd', 'is_active']);

const AVATAR_COLORS = ['emerald', 'blue', 'orange', 'purple', 'rose', 'teal', 'indigo', 'amber', 'cyan', 'lime'];
async function nextAvatarColor(): Promise<string> {
  const r = await db.selectFrom('testimonials_testimonial').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  return AVATAR_COLORS[r.n % AVATAR_COLORS.length]!;
}

register('testimonial', {
  table: 'testimonials_testimonial', objectName: 'Testimonial', resource: 'marketing.testimonials', auditLabel: 'testimonial',
  searchFields: ['name', 'location', 'quote'], filterable: { is_active: 'bool', rating: 'int' },
  orderingFields: ['created_at', 'rating'], defaultOrdering: '-created_at',
  specs: () => [
    { name: 'name', kind: 'char', maxLength: 100 },
    { name: 'location', kind: 'char', maxLength: 150, required: false, allowBlank: true },
    { name: 'rating', kind: 'int', required: false, ...USMALL },
    { name: 'quote', kind: 'char' },
    { name: 'avatar_color', kind: 'char', maxLength: 20, required: false, allowBlank: true },
    { name: 'is_active', kind: 'bool', required: false },
  ],
  represent: (r) => ({
    id: r.id, name: r.name, location: r.location, rating: r.rating, quote: r.quote, avatar_color: r.avatar_color, is_active: r.is_active, created_at: drf(r.created_at),
  }),
  repr: (r) => `${r.name} (${r.rating}★)`,
  async createRow(v) {
    const avatar = (v.avatar_color as string | undefined) || (await nextAvatarColor());
    return db.insertInto('testimonials_testimonial').values({
      user_id: null, name: v.name as string, location: (v.location ?? '') as string, rating: (v.rating ?? 5) as number, quote: v.quote as string,
      avatar_color: avatar, is_active: (v.is_active ?? true) as boolean, created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();
  },
  async beforeUpdate(r) { if (!r.avatar_color) r.avatar_color = await nextAvatarColor(); },
}, ['id', 'name', 'location', 'rating', 'quote', 'avatar_color', 'is_active', 'created_at']);

register('subscriber', {
  table: 'newsletter_subscriber', objectName: 'Subscriber', resource: 'marketing.newsletter', auditLabel: 'subscriber',
  searchFields: ['email'], filterable: { is_active: 'bool' },
  orderingFields: ['subscribed_at', 'email'], defaultOrdering: '-subscribed_at',
  specs: () => [
    { name: 'email', kind: 'email', maxLength: 254, unique: { table: 'newsletter_subscriber', column: 'email', message: 'subscriber with this email already exists.' } },
    { name: 'interests', kind: 'json', required: false },
    { name: 'is_active', kind: 'bool', required: false },
  ],
  represent: (r) => ({
    id: r.id, email: r.email, interests: r.interests, is_active: r.is_active, subscribed_at: drf(r.subscribed_at), unsubscribe_token: r.unsubscribe_token,
  }),
  repr: (r) => `${r.email} (${r.is_active ? 'active' : 'unsubscribed'})`,
  async createRow(v) {
    return db.insertInto('newsletter_subscriber').values({
      email: v.email as string, first_name: '', is_active: (v.is_active ?? true) as boolean, interests: json(v.interests ?? []),
      unsubscribe_token: randomBytes(48).toString('base64url'), subscribed_at: new Date(), unsubscribed_at: null,
    }).returningAll().executeTakeFirstOrThrow();
  },
}, ['id', 'email', 'interests', 'is_active', 'subscribed_at', 'unsubscribe_token'], true);

// --- views.py ------------------------------------------------------------------------

/** registry.get_config: Http404 → DRF NotFound(*args) */
function getConfig(key: string): ModelConfig {
  const c = REGISTRY.get(key);
  if (!c) throw new NotFound(`"${key}" is not a registered generic-admin model.`);
  return c;
}

async function authorize(req: ApiRequest, res: Response, c: ModelConfig, action: string): Promise<boolean> {
  if (!isSuperadminStaff(req.user) || !(await hasPermission(req.user, c.resource, action))) {
    res.status(403).json({ error: `${c.resource} access required` });
    return false;
  }
  return true;
}

const BOOL_TRUE = ['t', 'True', '1'];
const BOOL_FALSE = ['f', 'False', '0'];

/** qs.filter(**{f: val}) value prep (BooleanField/IntegerField.get_prep_value) — raises (→ 500) like Django. */
function prepFilter(field: string, kind: 'bool' | 'int', val: string | boolean): boolean | number | null {
  if (kind === 'bool') {
    if (typeof val === 'boolean') return val;
    if (BOOL_TRUE.includes(val)) return true;
    if (BOOL_FALSE.includes(val)) return false;
    throw new Error(`["“${val}” value must be either True or False."]`);
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  const m = /^\s*([+-]?\d+(?:_\d+)*)\s*$/u.exec(val);
  if (!m) throw new Error(`Field '${field}' expected a number but got '${val}'.`);
  const n = Number(m[1]!.replace(/_/g, ''));
  return Math.abs(n) > 2 ** 31 ? null : n; // out of range for the column → no match
}

/** Django icontains on Postgres: UPPER(col::text) LIKE UPPER('%escaped%') */
export function icontains(column: string, value: string): Expression<SqlBool> {
  const escaped = value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return sql<SqlBool>`UPPER(${sql.ref(column)}::text) LIKE UPPER(${`%${escaped}%`})`;
}

function ordering(req: Request, c: ModelConfig): string {
  const raw = qp(req, 'ordering') ?? c.defaultOrdering;
  return c.orderingFields.includes(raw.replace(/^-+/, '')) ? raw : c.defaultOrdering;
}

function listQuery(req: Request, c: ModelConfig) {
  let q = db.selectFrom(c.table as 'listings_propertycategory');
  for (const [f, kind] of Object.entries(c.filterable)) {
    const raw = qp(req, f);
    if (raw === undefined) continue;
    const val: string | boolean = raw === 'true' || raw === 'false' ? raw === 'true' : raw;
    const v = prepFilter(f, kind, val);
    q = v === null ? q.where(sql<SqlBool>`false`) : q.where(sql.ref(f), '=', v as never);
  }
  const search = pyStrip(qp(req, 'search') ?? '');
  if (search && c.searchFields.length) q = q.where((eb) => eb.or(c.searchFields.map((f) => icontains(f, search))));
  return q;
}

export async function genericListCreate(req: ApiRequest, res: Response) {
  const c = getConfig(String(req.params.model_key));
  const action = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'create';
  if (!(await authorize(req, res, c, action))) return;

  if (action === 'read') {
    const order = ordering(req, c);
    // A leading '--x' is accepted by the whitelist check (lstrip) and then rejected by order_by → 500, like Django.
    const desc = order.startsWith('-');
    const col = order.replace(/^-/, '');
    if (col.startsWith('-')) throw new Error(`Invalid order_by arguments: ['${order}']`);
    const page = await paginate(req, { pageSize: 25, pageSizeQueryParam: 'page_size', maxPageSize: 100 },
      async () => (await listQuery(req, c).select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n,
      (limit, offset) => listQuery(req, c).selectAll().orderBy(sql.ref(col), desc ? 'desc' : 'asc').limit(limit).offset(offset).execute());
    const results = [];
    for (const row of page.results) results.push(await c.represent(row as Row));
    return res.json({ ...page, results });
  }

  if (c.readOnly) return res.status(403).json({ error: 'This resource is read-only.' });
  const { data } = await requestData(req, res);
  const html = !!req.is(['multipart/form-data', 'application/x-www-form-urlencoded']);
  const { errors, values } = await validate(data, c.specs(null, data as Record<string, unknown>), { html });
  if (errors) return res.status(400).json(errors);
  const row = await c.createRow(values);
  await logAdminAction(req, `${c.auditLabel}.create`, { target: auditTarget(c.objectName, row.id, c.repr(row)), reason: pyStr(dget(data, 'reason', '')) });
  return res.status(201).json(await c.represent(row));
}

export async function genericDetail(req: ApiRequest, res: Response) {
  const c = getConfig(String(req.params.model_key));
  const action = ({ GET: 'read', HEAD: 'read', PATCH: 'update', DELETE: 'delete' } as Record<string, string>)[req.method]!;
  if (!(await authorize(req, res, c, action))) return;

  const pk = pkValue(String(req.params.pk));
  const instance = pk === null ? undefined : await db.selectFrom(c.table as 'listings_propertycategory').selectAll().where('id', '=', pk).executeTakeFirst() as Row | undefined;
  if (!instance) throw notFoundFor(c.objectName);

  if (action === 'read') return res.json(await c.represent(instance));
  if (c.readOnly) return res.status(403).json({ error: 'This resource is read-only.' });

  const { data } = await requestData(req, res);
  if (action === 'update') {
    const html = !!req.is(['multipart/form-data', 'application/x-www-form-urlencoded']);
    const initial = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
    const { errors, values } = await validate(data, c.specs(instance, initial), { partial: true, html, instanceId: instance.id });
    if (errors) return res.status(400).json(errors);
    const row: Row = { ...instance };
    for (const [k, v] of Object.entries(values)) row[k] = k === 'interests' ? v : v;
    await c.beforeUpdate?.(row);
    const { id, ...rest } = row;
    const set: Row = {};
    for (const [k, v] of Object.entries(rest)) set[k] = k === 'interests' || k === 'metadata' ? json(v) : v;
    const updated = await db.updateTable(c.table as 'listings_propertycategory').set(set as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow() as Row;
    await logAdminAction(req, `${c.auditLabel}.update`, {
      target: auditTarget(c.objectName, updated.id, c.repr(updated)),
      reason: pyStr(dget(data, 'reason', '')),
      metadata: { fields: Object.keys(initial) },
    });
    return res.json(await c.represent(updated));
  }

  // DELETE
  const reprBefore = c.repr(instance);
  await db.deleteFrom(c.table as 'listings_propertycategory').where('id', '=', instance.id).execute();
  await logAdminAction(req, `${c.auditLabel}.delete`, {
    target: null, reason: pyStr(dget(data, 'reason', '')), metadata: { deleted_id: instance.id, deleted_repr: reprBefore },
  });
  return res.status(204).end();
}
