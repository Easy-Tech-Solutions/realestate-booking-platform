// listings — /api/listings/ (port of listings/views.py + urls.py). All views are
// @api_view function views: AllowAny, default UserRateThrottle, auth checks inline.

import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { drf, nowPg } from '../../lib/datetime.js';
import { paginate } from '../../lib/drf.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { DEFAULT_FROM_EMAIL, sendMail } from '../../lib/mail.js';
import { apiView, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasAnyPermission, isFullAdmin } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction } from '../../domain/superadmin.js';
import { pyFloatRepr } from '../../lib/py.js';
import { Dec } from '../notifications/decimal.js';
import { buildExportWorkbook, buildTemplateWorkbook, importWorkbook } from './bulk.js';
import {
  dataGet, dateFromIsoformat, ormPk, dayNumber, dayToIso, isUpload, parseRequest, pkParam, pyInt, pyStrip, pyTypeName, pyRound,
  pystr, QueryDict, runSerializer, todayIso, type Upload,
} from './drf.js';
import { bookingOverlapExclusion, listingFilter, optimizedListingsQuery } from './filters.js';
import {
  createHotelRoom, createListing, deleteHotelRooms, deleteListing, deleteReviews, LISTING_DEFAULTS, saveListing,
} from './models.js';
import { BOOKING_ACTIVE_STATUSES, computeListingPricing, getAvailableRoomCount } from './pricing.js';
import {
  HOTEL_ROOM_FIELDS, IMAGE_FIELDS, LISTING_FIELDS, listingSettings, listingValidate, REVIEW_CREATE_FIELDS, REVIEW_FIELDS,
  serializeFavorites, serializeGalleryImage, serializeListing, serializeListingImageCreate, serializeListings, serializeReviews,
  serializeRoom, serializeRooms, type ListingRow,
} from './serializers.js';
import { saveUpload } from '../../lib/upload.js';
import { contains as locationContains } from '../trustsafety/models.js';

const r = djangoRouter('api/listings/');
const err = (status: number, body: Record<string, unknown>) => new HttpResponseError(status, body);
const authRequired = () => err(401, { error: 'Authentication required' });
const q1 = (req: Request, k: string): string | undefined => {
  const v = req.query[k];
  const x = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof x === 'string' ? x : undefined;
};

async function getListing(id: unknown): Promise<ListingRow | null> {
  const pk = pkParam(id);
  if (pk === null) return null;
  return (await db.selectFrom('listings_listing').selectAll().where('id', '=', pk).executeTakeFirst()) ?? null;
}
async function listingOr404(id: unknown): Promise<ListingRow> {
  const l = await getListing(id);
  if (!l) throw notFoundFor('Listing');
  return l;
}

/** views._is_admin(user, resource=None) */
async function isAdmin(user: User | null, resource?: string): Promise<boolean> {
  if (isFullAdmin(user)) return true;
  if (resource && user && isSuperadminStaff(user)) return hasAnyPermission(user, resource);
  return false;
}

/** _require_listing_content */
async function requireListingContent(user: User | null): Promise<boolean> {
  if (!user) return false;
  return isFullAdmin(user) || (await hasAnyPermission(user, 'listings.content'));
}

/** _check_image_size(request) */
function checkImageSize(files: Map<string, Upload[]>) {
  for (const list of files.values()) {
    const f = list[list.length - 1]!;
    if (f.size > 10 * 1024 * 1024) throw err(413, { error: `File '${f.name}' is too large. Maximum allowed is 10 MB.` });
  }
}

/** int(request.GET.get('days', default)) → number, or null on ValueError. */
function daysParam(req: Request, dflt: number): number | null {
  const raw = q1(req, 'days');
  if (raw === undefined) return dflt;
  const n = pyInt(raw);
  return n === null ? null : Number(n);
}
/** end - timedelta(days) with OverflowError (→ 500) outside date range. */
function periodStart(endIso: string, days: number): string {
  const n = dayNumber(endIso) - days;
  if (n < dayNumber('0001-01-01') || n > dayNumber('9999-12-31')) throw new Error('date value out of range');
  return dayToIso(n);
}

// ---- categories / settings ------------------------------------------------------------------

r.path('categories/', apiView({
  async GET(req) {
    let q = db.selectFrom('listings_propertycategory').selectAll().orderBy('sort_order').orderBy('name');
    if (!(await isAdmin(req.user))) q = q.where('is_active', '=', true);
    return (await q.execute()).map((c) => ({ id: c.id, name: c.name, slug: c.slug, is_active: c.is_active, sort_order: c.sort_order }));
  },
}));

const serializeSettings = (s: { min_monthly_price: string; updated_at: string }) => ({ min_monthly_price: s.min_monthly_price, updated_at: drf(s.updated_at) });

r.path('settings/', apiView({
  async GET() {
    return serializeSettings(await listingSettings());
  },
  async PATCH(req, res) {
    const current = await listingSettings();
    if (!(await isAdmin(req.user, 'listings.settings'))) return res.status(403).json({ error: 'Permission denied' });
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, [['min_monthly_price', { kind: 'decimal', required: false, maxDigits: 12, decimalPlaces: 2 }]], { partial: true });
    if (v.errors) return res.status(400).json(v.errors);
    const saved = await db.updateTable('listings_listingsettings').set({ ...v.values, updated_at: nowPg() } as never)
      .where('id', '=', 1).returningAll().executeTakeFirstOrThrow();
    const out = serializeSettings(saved);
    const price = (v.values.min_monthly_price as string | undefined) ?? current.min_monthly_price;
    await logAdminAction(req, 'listing_settings.update', {
      target: auditTarget('ListingSettings', 1, `Minimum listing price: $${price}`), metadata: { metadata_snapshot: out },
    });
    return out;
  },
}));

// ---- host dashboards ----------------------------------------------------------------------------

r.path('my-drafts/', apiView({
  async GET(req) {
    if (!req.user) throw authRequired();
    const rows = await db.selectFrom('listings_listing').selectAll().where('owner_id', '=', req.user.id).where('status', '=', 'draft')
      .where('deleted_at', 'is', null).orderBy('updated_at', 'desc').execute();
    return serializeListings(rows, req);
  },
}));

r.path('my-listings/', apiView({
  async GET(req) {
    if (!req.user) throw authRequired();
    const rows = await db.selectFrom('listings_listing').selectAll().where('owner_id', '=', req.user.id).where('deleted_at', 'is', null)
      .where('status', '!=', 'draft').orderBy('created_at', 'desc').execute();
    return serializeListings(rows, req);
  },
}));

r.path('pending-review/', apiView({
  async GET(req) {
    if (!(await requireListingContent(req.user))) throw err(403, { error: 'Admin access required' });
    const rows = await db.selectFrom('listings_listing').selectAll().where('status', '=', 'pending_review').orderBy('created_at', 'desc').execute();
    return serializeListings(rows, req);
  },
}));

// ---- bulk ---------------------------------------------------------------------------------------------

function xlsx(res: Response, buf: Buffer, filename: string) {
  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buf);
}

r.path('bulk/template/', apiView({
  async GET(req, res) {
    if (!req.user) throw authRequired();
    xlsx(res, await buildTemplateWorkbook(), 'homekonet-listings-template.xlsx');
  },
}));

r.path('bulk/export/', apiView({
  async GET(req, res) {
    if (!req.user) throw authRequired();
    const ownerId = q1(req, 'owner_id');
    let q = db.selectFrom('listings_listing').selectAll().where('deleted_at', 'is', null);
    if (await isAdmin(req.user, 'listings.bulk_import')) {
      if (ownerId) {
        const pk = ormPk(ownerId, 'owner');
        q = pk === null ? q.where(sql<boolean>`false`) : q.where('owner_id', '=', pk);
      }
    } else q = q.where('owner_id', '=', req.user.id);
    const rows = await q.orderBy('created_at', 'desc').limit(1000).execute();
    xlsx(res, await buildExportWorkbook(rows), 'homekonet-listings-export.xlsx');
  },
}));

r.path('bulk/import/', apiView({
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const { files } = await parseRequest(req, res, ['multipart', 'form']);
    const list = files.get('file');
    const upload = list?.[list.length - 1];
    if (!upload) return res.status(400).json({ error: "No file uploaded (expected form field 'file')." });
    if (upload.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'File is too large. Maximum allowed is 5 MB.' });
    if (!upload.name.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ error: 'Please upload the .xlsx template file.' });
    const admin = await isAdmin(req.user, 'listings.bulk_import');
    let created: ListingRow[]; let rowErrors: unknown[];
    try {
      [created, rowErrors] = await importWorkbook(upload.data, req.user, admin);
    } catch (e) {
      return res.status(400).json({ error: `Could not read this file: ${(e as Error).message}` });
    }
    if (created.length) {
      await logAdminAction(req, 'listings.bulk_import', { reason: `${created.length} listing(s) imported, ${rowErrors.length} row error(s)` });
    }
    return res.status(created.length ? 201 : 400).json({
      created_count: created.length, created_listing_ids: created.map((l) => l.id), row_errors: rowErrors,
    });
  },
}));

// ---- approve / reject / duplicate -------------------------------------------------------------------

const STAGE_OF: Record<string, string> = { submitted: 'product_support', ps_approved: 'compliance', compliance_approved: 'supervisor' };

async function sendMailSilently(subject: string, message: string, to: string) {
  try { await sendMail(subject, message, DEFAULT_FROM_EMAIL, [to]); } catch { /* fail_silently=True */ }
}

r.path('<int:id>/approve/', apiView({
  async POST(req) {
    if (!(await requireListingContent(req.user))) throw err(403, { error: 'Admin access required' });
    const listing = await getListing(req.params.id);
    if (!listing) throw err(404, { error: 'Listing not found' });
    if (!['pending_review', 'rejected'].includes(listing.status)) throw err(400, { error: 'Listing is not pending review' });
    const verification = await db.selectFrom('propertyverifications_propertyverification').selectAll().where('listing_id', '=', listing.id)
      .orderBy('created_at', 'desc').executeTakeFirst();
    const needsPipeline = !!verification && verification.status !== 'approved';
    if (needsPipeline && !isFullAdmin(req.user)) {
      throw err(409, {
        error: 'This listing has a property verification in progress. Approve it from the Verification queue instead — approving here would skip Product Support/Compliance/Supervisor review.',
        verification_id: verification!.id,
      });
    }
    if (needsPipeline) {
      const note = `Fast-tracked by superadmin ${req.user!.username} via the listing-approval queue, bypassing remaining review stages.`;
      await db.updateTable('propertyverifications_propertyverification')
        .set({ review_notes: pyStrip(`${verification!.review_notes}\n${note}`), status: 'approved', updated_at: nowPg() })
        .where('id', '=', verification!.id).execute();
    }
    const saved = await saveListing(listing.id, { status: 'published', is_available: true }, { updateFields: ['status', 'is_available'] });
    await logAdminAction(req, 'listing.approve', { target: auditTarget('Listing', saved.id, saved.title), reason: `${saved.title} -> published` });
    const owner = await db.selectFrom('users_user').select(['first_name', 'email']).where('id', '=', saved.owner_id).executeTakeFirstOrThrow();
    await sendMailSilently('Your listing has been approved — HomeKonet',
      `Hi ${owner.first_name},\n\nGreat news! Your listing "${saved.title}" has been reviewed and approved. It is now live on HomeKonet.\n\nThank you for being part of our community!\n\nThe HomeKonet Team`,
      owner.email);
    return serializeListing(saved, req);
  },
}));

r.path('<int:id>/reject/', apiView({
  async POST(req, res) {
    if (!(await requireListingContent(req.user))) throw err(403, { error: 'Admin access required' });
    const listing = await getListing(req.params.id);
    if (!listing) throw err(404, { error: 'Listing not found' });
    const verification = await db.selectFrom('propertyverifications_propertyverification').selectAll().where('listing_id', '=', listing.id)
      .orderBy('created_at', 'desc').executeTakeFirst();
    const needsPipeline = !!verification && verification.status !== 'approved';
    if (needsPipeline && !isFullAdmin(req.user)) {
      throw err(409, {
        error: 'This listing has a property verification in progress. Reject it from the Verification queue instead.',
        verification_id: verification!.id,
      });
    }
    const { data } = await parseRequest(req, res);
    const reason = dataGet(data, 'reason', '');
    const truthy = !!reason && !(Array.isArray(reason) && !reason.length) && !(typeof reason === 'object' && !Array.isArray(reason) && !Object.keys(reason as object).length) && reason !== 0;
    if (needsPipeline) {
      const stage = STAGE_OF[verification!.status] || verification!.outcome_stage;
      await db.updateTable('propertyverifications_propertyverification').set({
        status: 'rejected', outcome_stage: stage,
        review_notes: truthy ? pystr(reason) : `Rejected by superadmin ${req.user!.username} via the listing-rejection queue.`,
        updated_at: nowPg(),
      }).where('id', '=', verification!.id).execute();
    }
    const saved = await saveListing(listing.id, { status: 'rejected' }, { updateFields: ['status'] });
    await logAdminAction(req, 'listing.reject', { target: auditTarget('Listing', saved.id, saved.title), reason: truthy ? pystr(reason) : `${saved.title} rejected` });
    const owner = await db.selectFrom('users_user').select(['first_name', 'email']).where('id', '=', saved.owner_id).executeTakeFirstOrThrow();
    let msg = `Hi ${owner.first_name},\n\nUnfortunately, your listing "${saved.title}" was not approved at this time.`;
    if (truthy) msg += `\n\nReason: ${pystr(reason)}`;
    msg += '\n\nYou may update your listing and resubmit, or contact us at homekonnet@gmail.com for help.\n\nThe HomeKonet Team';
    await sendMailSilently('Update on your listing submission — HomeKonet', msg, owner.email);
    return { status: 'rejected', reason };
  },
}));

const DUPLICATE_SKIP = new Set(['id', 'created_at', 'updated_at', 'status', 'deleted_at', 'is_available', 'suspended_by_id', 'suspended_at',
  'suspension_reason', 'local_registration_number', 'occupancy_cap', 'claimed_by_user_id']);

r.path('<int:id>/duplicate/', apiView({
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const original = await listingOr404(req.params.id);
    if (original.owner_id !== req.user.id && !(await isAdmin(req.user))) throw err(403, { error: 'Permission denied' });
    const copy: Record<string, unknown> = {};
    for (const k of [...Object.keys(LISTING_DEFAULTS), 'owner_id', 'title']) if (!DUPLICATE_SKIP.has(k)) copy[k] = (original as Record<string, unknown>)[k];
    copy.title = `${original.title} (Copy)`;
    copy.amenities = original.amenities;
    copy.highlights = original.highlights;
    const dup = await createListing(copy, { status: 'draft', is_available: false });
    const imgs = await db.selectFrom('listings_listingimage').selectAll().where('listing_id', '=', original.id).orderBy('order').execute();
    for (const im of imgs) {
      await db.insertInto('listings_listingimage').values({ listing_id: dup.id, image: im.image, caption: im.caption, order: im.order, created_at: nowPg() }).execute();
    }
    const rooms = await db.selectFrom('listings_hotelroom').selectAll().where('listing_id', '=', original.id).orderBy('room_type').orderBy('price_per_night').execute();
    for (const room of rooms) {
      await createHotelRoom({
        name: room.name, room_type: room.room_type, description: room.description, price_per_night: room.price_per_night,
        max_occupancy: room.max_occupancy, beds: room.beds, bed_type: room.bed_type, bathrooms: room.bathrooms,
        amenities: room.amenities, total_count: room.total_count, is_active: room.is_active,
      }, dup.id);
    }
    await logAdminAction(req, 'listing.duplicate', { target: auditTarget('Listing', dup.id, dup.title), reason: `Duplicated from listing #${original.id}` });
    return res.status(201).json(await serializeListing(dup, req));
  },
}));

// ---- reviews -----------------------------------------------------------------------------------------

r.path('reviews/', apiView({
  async GET(req) {
    let q = db.selectFrom('listings_review').selectAll();
    const minRating = q1(req, 'min_rating');
    if (minRating) {
      const n = pyInt(minRating);
      if (n !== null) q = n > 2147483647n ? q.where(sql<boolean>`false`) : n < -2147483648n ? q : q.where('rating', '>=', Number(n));
    }
    const lid = q1(req, 'listing_id');
    if (lid) {
      const pk = ormPk(lid, 'listing');
      q = pk === null ? q.where(sql<boolean>`false`) : q.where('listing_id', '=', pk);
    }
    const ordering = q1(req, 'ordering') ?? '-created_at';
    if (['created_at', '-created_at', 'rating', '-rating'].includes(ordering)) {
      q = q.orderBy(ordering.replace('-', '') as 'rating', ordering.startsWith('-') ? 'desc' : 'asc');
    } else q = q.orderBy('created_at', 'desc');
    const qq = q;
    return paginate(req, { pageSize: 12, pageSizeQueryParam: 'page_size', maxPageSize: 100 },
      async () => Number((await db.selectFrom(qq.as('s')).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n),
      async (limit, offset) => serializeReviews(await qq.limit(limit).offset(offset).execute(), req));
  },
}));

r.path('reviews/create/', apiView({
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const { data } = await parseRequest(req, res);
    const pk = ormPk(dataGet(data, 'listing'));
    const listing = pk === null ? null : await db.selectFrom('listings_listing').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!listing) throw notFoundFor('Listing');
    const today = todayIso();
    const stay = await db.selectFrom('bookings_booking').select('id').where('listing_id', '=', listing.id).where('customer_id', '=', req.user.id)
      .where((eb) => eb.or([eb('status', '=', 'completed'), eb.and([eb('status', '=', 'confirmed'), eb('end_date', '<', today)])]))
      .executeTakeFirst();
    if (!stay) return res.status(400).json({ error: 'You must complete a stay before leaving a review' });
    const existing = await db.selectFrom('listings_review').select('id').where('listing_id', '=', listing.id).where('reviewer_id', '=', req.user.id).executeTakeFirst();
    if (existing) return res.status(400).json({ error: 'You have already reviewed this listing' });
    const v = await runSerializer(data, REVIEW_CREATE_FIELDS);
    if (v.errors) return res.status(400).json(v.errors);
    const vals = v.values;
    const now = nowPg();
    const review = await db.insertInto('listings_review').values({
      listing_id: (vals.listing as ListingRow).id, reviewer_id: req.user.id, rating: vals.rating as number,
      title: vals.title as string, content: vals.content as string,
      cleanliness: (vals.cleanliness as number | undefined) ?? null, accuracy: (vals.accuracy as number | undefined) ?? null,
      check_in_rating: (vals.check_in_rating as number | undefined) ?? null, communication: (vals.communication as number | undefined) ?? null,
      location_rating: (vals.location_rating as number | undefined) ?? null, value: (vals.value as number | undefined) ?? null,
      host_response: '', host_response_at: null, is_verified: false, created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    for (const img of (vals.images as Upload[] | undefined) ?? []) {
      const name = await saveUpload('reviews/', img.name, img.data);
      await db.insertInto('listings_reviewimage').values({ review_id: review.id, image: name, caption: '', created_at: nowPg() }).execute();
    }
    return res.status(201).json((await serializeReviews([review], req))[0]);
  },
}));

async function reviewOr404(id: unknown) {
  const pk = pkParam(id);
  const rv = pk === null ? undefined : await db.selectFrom('listings_review').selectAll().where('id', '=', pk).executeTakeFirst();
  if (!rv) throw notFoundFor('Review');
  return rv;
}

r.path('reviews/<int:id>/', apiView({
  async GET(req) {
    if (!req.user) throw authRequired();
    return (await serializeReviews([await reviewOr404(req.params.id)], req))[0];
  },
  async PUT(req, res) {
    if (!req.user) throw authRequired();
    const rv = await reviewOr404(req.params.id);
    if (rv.reviewer_id !== req.user.id && !req.user.is_superuser) return res.status(403).json({ error: 'Permission denied' });
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, REVIEW_FIELDS, { partial: true });
    if (v.errors) return res.status(400).json(v.errors);
    const set: Record<string, unknown> = { ...v.values, updated_at: nowPg() };
    if (set.listing) { set.listing_id = (set.listing as ListingRow).id; delete set.listing; }
    const saved = await db.updateTable('listings_review').set(set as never).where('id', '=', rv.id).returningAll().executeTakeFirstOrThrow();
    return (await serializeReviews([saved], req))[0];
  },
  async DELETE(req, res) {
    if (!req.user) throw authRequired();
    const rv = await reviewOr404(req.params.id);
    if (rv.reviewer_id !== req.user.id && !req.user.is_superuser) return res.status(403).json({ error: 'Permission denied' });
    await db.transaction().execute((trx) => deleteReviews([rv.id], trx));
    return res.status(204).json({ message: 'Review deleted' });
  },
}));

r.path('reviews/<int:id>/respond/', apiView({
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const rv = await reviewOr404(req.params.id);
    const listing = await db.selectFrom('listings_listing').select('owner_id').where('id', '=', rv.listing_id).executeTakeFirstOrThrow();
    if (listing.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the listing owner can respond to reviews' });
    const { data } = await parseRequest(req, res);
    const raw = dataGet(data, 'response', '');
    if (typeof raw !== 'string') throw new TypeError(`'${pyTypeName(raw)}' object has no attribute 'strip'`);
    const text = pyStrip(raw);
    if (!text) return res.status(400).json({ error: 'Response text is required' });
    const now = nowPg();
    const saved = await db.updateTable('listings_review').set({ host_response: text, host_response_at: now, updated_at: now })
      .where('id', '=', rv.id).returningAll().executeTakeFirstOrThrow();
    return (await serializeReviews([saved], req))[0];
  },
}));

r.path('users/<int:user_id>/reviews/', apiView({
  async GET(req) {
    const pk = pkParam(req.params.user_id);
    const u = pk === null ? undefined : await db.selectFrom('users_user').select('id').where('id', '=', pk).executeTakeFirst();
    if (!u) throw notFoundFor('User');
    const rows = await db.selectFrom('listings_review').selectAll().where('reviewer_id', '=', u.id).orderBy('created_at', 'desc').execute();
    return serializeReviews(rows, req);
  },
}));

// ---- collection / detail -----------------------------------------------------------------------------

r.path('', apiView({
  async GET(req) {
    const { where, orderBy } = listingFilter(req.query);
    const base = [
      sql`"listings_listing"."deleted_at" IS NULL`, sql`"listings_listing"."is_available"`, sql`"listings_listing"."status" = 'published'`,
      ...where,
    ];
    const checkIn = q1(req, 'check_in');
    const checkOut = q1(req, 'check_out');
    if (checkIn && checkOut) base.push(bookingOverlapExclusion(checkIn, checkOut));
    const qs = optimizedListingsQuery(base, orderBy);
    return paginate(req, { pageSize: 20, pageSizeQueryParam: 'page_size', maxPageSize: 100 }, qs.count,
      async (limit, offset) => serializeListings(await qs.fetch(limit, offset), req));
  },
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const { data } = await parseRequest(req, res, ['multipart', 'form']);
    const v = await runSerializer(data, LISTING_FIELDS, { validate: listingValidate(null) });
    if (v.errors) return res.status(400).json(v.errors);
    const lat = v.values.latitude; const lng = v.values.longitude;
    if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
      const locs = await db.selectFrom('trustsafety_blacklistedlocation').selectAll().orderBy('created_at', 'desc').execute();
      if (locs.some((loc) => locationContains(loc, lat as string, lng as string))) {
        return res.status(403).json({ error: 'This location is not eligible to be listed on the platform.' });
      }
    }
    const newStatus = dataGet(data, 'status') === 'draft' ? 'draft' : 'pending_review';
    const listing = await createListing(v.values, { owner_id: req.user.id, status: newStatus });
    return res.status(201).json(await serializeListing(listing, req));
  },
}));

r.path('<int:id>/', apiView({
  async GET(req) {
    const item = await getListing(req.params.id);
    if (!item) throw err(404, { error: 'Listing not found' });
    if (item.deleted_at !== null && !(req.user && (item.owner_id === req.user.id || req.user.is_superuser))) {
      throw err(404, { error: 'Listing not found' });
    }
    return serializeListing(item, req);
  },
  async PUT(req, res) {
    const item = await getListing(req.params.id);
    if (!item) throw err(404, { error: 'Listing not found' });
    if (!req.user) throw authRequired();
    if (item.owner_id !== req.user.id && !(await isAdmin(req.user))) return res.status(403).json({ error: 'Permission denied' });
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, LISTING_FIELDS, { partial: true, validate: listingValidate(item) });
    if (v.errors) return res.status(400).json(v.errors);
    const saved = await saveListing(item.id, v.values);
    return serializeListing(saved, req);
  },
  async DELETE(req, res) {
    const item = await getListing(req.params.id);
    if (!item) throw err(404, { error: 'Listing not found' });
    if (!req.user) throw authRequired();
    if (item.owner_id !== req.user.id && !(await isAdmin(req.user))) return res.status(403).json({ error: 'Permission denied' });
    const [ok, error] = await deleteListing(item);
    if (!ok) return res.status(400).json({ detail: error });
    return res.status(204).end();
  },
}));

// ---- gallery images ---------------------------------------------------------------------------------

r.path('<int:listing_id>/images/', apiView({
  async GET(req) {
    const listing = await getListing(req.params.listing_id);
    if (!listing) throw err(404, { error: 'Listing not found' });
    const imgs = await db.selectFrom('listings_listingimage').selectAll().where('listing_id', '=', listing.id).orderBy('order').execute();
    return imgs.map(serializeListingImageCreate);
  },
  async POST(req, res) {
    const listing = await getListing(req.params.listing_id);
    if (!listing) throw err(404, { error: 'Listing not found' });
    if (!req.user) throw authRequired();
    if (listing.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can add images' });
    const { data, files } = await parseRequest(req, res);
    checkImageSize(files);
    const v = await runSerializer(data, IMAGE_FIELDS);
    if (v.errors) return res.status(400).json(v.errors);
    const { m } = await db.selectFrom('listings_listingimage').select((eb) => eb.fn.max('order').as('m')).where('listing_id', '=', listing.id).executeTakeFirstOrThrow();
    const order = m === null || m === undefined ? 0 : Number(m) + 1;
    const name = await saveUpload('listings/gallery/', (v.values.image as Upload).name, (v.values.image as Upload).data);
    try {
      const img = await db.insertInto('listings_listingimage').values({
        listing_id: listing.id, image: name, caption: (v.values.caption as string | undefined) ?? '', order, created_at: nowPg(),
      }).returningAll().executeTakeFirstOrThrow();
      return res.status(201).json(serializeListingImageCreate(img));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        return res.status(400).json({ error: 'An image with this display order already exists for the listing. Please try again.' });
      }
      throw e;
    }
  },
}));

r.path('<int:listing_id>/images/<int:image_id>/', apiView({
  async DELETE(req, res) {
    const listing = await getListing(req.params.listing_id);
    const imgPk = pkParam(req.params.image_id);
    const image = listing && imgPk !== null
      ? await db.selectFrom('listings_listingimage').selectAll().where('listing_id', '=', listing.id).where('id', '=', imgPk).executeTakeFirst()
      : undefined;
    if (!listing || !image) return res.status(404).json({ error: 'Not Found' });
    if (!req.user) throw authRequired();
    if (listing.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete images' });
    await db.deleteFrom('listings_listingimage').where('id', '=', image.id).execute();
    return res.status(204).json({ message: 'Image deleted' });
  },
}));

// ---- favorites ------------------------------------------------------------------------------------------

r.path('<int:id>/favorite/', apiView({
  async POST(req, res) {
    if (!req.user) throw authRequired();
    const listing = await listingOr404(req.params.id);
    let fav = await db.selectFrom('listings_favorite').selectAll().where('user_id', '=', req.user.id).where('listing_id', '=', listing.id).executeTakeFirst();
    let created = false;
    if (!fav) {
      fav = await db.insertInto('listings_favorite').values({ user_id: req.user.id, listing_id: listing.id, created_at: nowPg() }).returningAll().executeTakeFirstOrThrow();
      created = true;
    }
    return res.status(created ? 201 : 200).json((await serializeFavorites([fav], req))[0]);
  },
  async DELETE(req, res) {
    if (!req.user) throw authRequired();
    const listing = await listingOr404(req.params.id);
    await db.deleteFrom('listings_favorite').where('user_id', '=', req.user.id).where('listing_id', '=', listing.id).execute();
    return res.status(204).json({ message: 'Favorite listing deleted' });
  },
}));

r.path('favorites/', apiView({
  async GET(req) {
    if (!req.user) throw authRequired();
    const favs = await db.selectFrom('listings_favorite').selectAll().where('user_id', '=', req.user.id).orderBy('created_at', 'desc').execute();
    return serializeFavorites(favs, req);
  },
}));

r.path('<int:listing_id>/reviews/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const rows = await db.selectFrom('listings_review').selectAll().where('listing_id', '=', listing.id).orderBy('created_at', 'desc').execute();
    return serializeReviews(rows, req);
  },
}));

// ---- stats / analytics ------------------------------------------------------------------------------------

const rate = (a: number, b: number) => (b > 0 ? pyRound((a / b) * 100, 2) : 0);

r.path('<int:listing_id>/stats/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    if (!req.user) throw authRequired();
    if (listing.owner_id !== req.user.id && !req.user.is_superuser) throw err(403, { error: 'Permission denied' });
    let days = daysParam(req, 30);
    if (days === null) throw err(400, { error: 'days must be a valid integer' });
    days = Math.min(days, 365);
    const end = todayIso();
    const start = periodStart(end, days);
    const one = async (q: Promise<{ n: unknown } | undefined>) => Number((await q)?.n ?? 0);
    const totalViews = await one(db.selectFrom('listings_propertyview').select((eb) => eb.fn.countAll().as('n')).where('listing_id', '=', listing.id).executeTakeFirst());
    const uniqueViews = await one(db.selectFrom('listings_propertyview').select(sql`COUNT(DISTINCT ip_address)`.as('n')).where('listing_id', '=', listing.id).executeTakeFirst());
    const totalFavorites = await one(db.selectFrom('listings_favorite').select((eb) => eb.fn.countAll().as('n')).where('listing_id', '=', listing.id).executeTakeFirst());
    const totalBookings = await one(db.selectFrom('bookings_booking').select((eb) => eb.fn.countAll().as('n')).where('listing_id', '=', listing.id).executeTakeFirst());
    const rev = await db.selectFrom('bookings_booking').select(sql<string | null>`SUM(total_price)`.as('t')).where('listing_id', '=', listing.id).where('status', '=', 'confirmed').executeTakeFirst();
    const daily = await db.selectFrom('listings_propertystats').selectAll().where('listing_id', '=', listing.id)
      .where('date', '>=', start).where('date', '<=', end).orderBy('date').execute();
    return {
      listing: { id: listing.id, title: listing.title, price: listing.price },
      summary: {
        total_views: totalViews, unique_views: uniqueViews, total_favorites: totalFavorites, total_bookings: totalBookings,
        total_revenue: rev?.t && Number(rev.t) !== 0 ? rev.t : '0',
        view_to_favorite_rate: rate(totalFavorites, totalViews), view_to_booking_rate: rate(totalBookings, totalViews),
      },
      daily_stats: daily.map((s) => ({ date: String(s.date).slice(0, 10), views: s.views, unique_views: s.unique_views, favorites: s.favorites, bookings: s.bookings, revenue: s.revenue })),
      period: { start_date: start, end_date: end, days },
    };
  },
}));

r.path('analytics/agent/', apiView({
  async GET(req) {
    if (!req.user) throw authRequired();
    const user = req.user;
    if (!['agent', 'admin', 'superadmin'].includes(user.role)) throw err(403, { error: 'Permission denied' });
    let days = daysParam(req, 30);
    if (days === null) throw err(400, { error: 'days must be a valid integer' });
    days = Math.min(days, 365);
    const end = todayIso();
    const start = periodStart(end, days);
    const rows = (await sql<{ id: number; title: string; price: string; view_count: number; favorite_count: number; booking_count: number; confirmed_revenue: string | null }>`
      SELECT "listings_listing".*, COUNT(DISTINCT "listings_propertyview"."id") AS "view_count", COUNT(DISTINCT "listings_favorite"."id") AS "favorite_count",
        COUNT(DISTINCT "bookings_booking"."id") AS "booking_count",
        SUM("bookings_booking"."total_price") FILTER (WHERE "bookings_booking"."status" = 'confirmed') AS "confirmed_revenue"
      FROM "listings_listing" LEFT OUTER JOIN "listings_propertyview" ON ("listings_listing"."id" = "listings_propertyview"."listing_id")
        LEFT OUTER JOIN "listings_favorite" ON ("listings_listing"."id" = "listings_favorite"."listing_id")
        LEFT OUTER JOIN "bookings_booking" ON ("listings_listing"."id" = "bookings_booking"."listing_id")
      WHERE "listings_listing"."owner_id" = ${user.id} GROUP BY "listings_listing"."id"`.execute(db)).rows;
    let total: Dec | null = null;
    for (const l of rows) {
      if (l.confirmed_revenue !== null && Number(l.confirmed_revenue) !== 0) total = total ? total.add(l.confirmed_revenue) : Dec.from(l.confirmed_revenue);
    }
    const totalRevenue = total ? total.toString() : '0';
    const perf = rows.map((l) => ({
      id: l.id, title: l.title, price: l.price, views: Number(l.view_count), favorites: Number(l.favorite_count),
      bookings: Number(l.booking_count), revenue: l.confirmed_revenue !== null && Number(l.confirmed_revenue) !== 0 ? l.confirmed_revenue : '0',
    }));
    perf.sort((a, b) => Number(b.revenue) - Number(a.revenue));
    return {
      agent: { id: user.id, username: user.username, role: user.role },
      summary: {
        total_listings: rows.length, total_views: perf.reduce((a, p) => a + p.views, 0), total_favorites: perf.reduce((a, p) => a + p.favorites, 0),
        total_bookings: perf.reduce((a, p) => a + p.bookings, 0), total_revenue: totalRevenue,
      },
      property_performance: perf,
      period: { start_date: start, end_date: end, days },
    };
  },
}));

r.path('analytics/popular/', apiView({
  async GET(req) {
    const raw = q1(req, 'days');
    const n = raw === undefined ? 7n : pyInt(raw);
    if (n === null) throw new Error(`invalid literal for int() with base 10: '${raw}'`);
    const end = todayIso();
    const start = periodStart(end, Number(n));
    const counts = (await sql<{ listing: number; view_count: number }>`SELECT "listings_propertyview"."listing_id" AS "listing", COUNT("listings_propertyview"."id") AS "view_count"
      FROM "listings_propertyview" WHERE (("listings_propertyview"."timestamp" AT TIME ZONE 'UTC')::date >= ${start}::date AND ("listings_propertyview"."timestamp" AT TIME ZONE 'UTC')::date <= ${end}::date)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 20`.execute(db)).rows;
    const ids = counts.map((c) => c.listing);
    const listings = ids.length ? (await sql<ListingRow & { favorite_count: number; owner_username: string }>`
      SELECT "listings_listing".*, COUNT(DISTINCT "listings_favorite"."id") AS "favorite_count", "users_user"."username" AS "owner_username"
      FROM "listings_listing" LEFT OUTER JOIN "listings_favorite" ON ("listings_listing"."id" = "listings_favorite"."listing_id")
      INNER JOIN "users_user" ON ("listings_listing"."owner_id" = "users_user"."id")
      WHERE "listings_listing"."id" IN (${sql.join(ids)}) GROUP BY "listings_listing"."id", "users_user"."id"`.execute(db)).rows : [];
    const by = new Map(listings.map((l) => [l.id, l]));
    const { fileUrl } = await import('../../lib/drf.js');
    const result = [];
    for (const item of counts) {
      const l = by.get(item.listing);
      if (!l) continue;
      result.push({
        id: l.id, title: l.title, price: l.price, property_type: l.property_type, address: l.address,
        main_image_url: l.main_image ? fileUrl(req, l.main_image) : null, owner_username: l.owner_username,
        views: Number(item.view_count), favorites: Number(l.favorite_count),
      });
    }
    return { popular_listings: result };
  },
}));

r.path('nearby/', apiView({
  async GET(req) {
    const latRaw = q1(req, 'lat'); const lngRaw = q1(req, 'lng');
    const bad = () => err(400, { error: 'lat and lng query params are required and must be valid numbers.' });
    if (latRaw === undefined || lngRaw === undefined) throw bad();
    if (pyStrip(latRaw).toLowerCase() === 'nan' || pyStrip(lngRaw).toLowerCase() === 'nan') throw bad();
    const userLat = pyFloat(latRaw); const userLng = pyFloat(lngRaw);
    if (userLat === null || userLng === null) throw bad();
    const radiusRaw = q1(req, 'radius') ?? '50';
    let radius: number;
    if (pyStrip(radiusRaw).toLowerCase() === 'nan') radius = 50;
    else { const f = pyFloat(radiusRaw); radius = f === null ? 50 : (200 < f ? 200 : f); }
    const rows = (await sql<ListingRow>`SELECT "listings_listing".* FROM "listings_listing" INNER JOIN "users_user" ON ("listings_listing"."owner_id" = "users_user"."id")
      WHERE ("listings_listing"."deleted_at" IS NULL AND "listings_listing"."is_available" AND "listings_listing"."latitude" IS NOT NULL AND "listings_listing"."longitude" IS NOT NULL
        AND "listings_listing"."status" = 'published' AND NOT ("listings_listing"."latitude" = 0 AND "listings_listing"."latitude" IS NOT NULL AND "listings_listing"."longitude" = 0 AND "listings_listing"."longitude" IS NOT NULL))`.execute(db)).rows;
    const near: [number, ListingRow][] = [];
    for (const l of rows) {
      const d = haversine(userLat, userLng, Number(l.latitude), Number(l.longitude));
      if (d <= radius) near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const top = near.slice(0, 12);
    const ser = await serializeListings(top.map(([, l]) => l), req);
    return ser.map((s, i) => ({ ...s, distance_km: pyRound(top[i]![0], 1) }));
  },
}));

/** Python float(str) — null on ValueError. */
function pyFloat(s: string): number | null {
  const t = pyStrip(s);
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!/^[+-]?((\d(_?\d)*)?\.?\d(_?\d)*|\d(_?\d)*\.)([eE][+-]?\d(_?\d)*)?$/.test(t)) return null;
  return Number(t.replace(/_/g, ''));
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (x: number) => x * (Math.PI / 180);
  const check = (x: number) => { if (!Number.isFinite(x) && !Number.isNaN(x)) throw new Error('math domain error'); return x; };
  const [a1, o1, a2, o2] = [lat1, lon1, lat2, lon2].map(rad) as [number, number, number, number];
  const dlat = a2 - a1; const dlon = o2 - o1;
  const a = Math.sin(check(dlat / 2)) ** 2 + Math.cos(check(a1)) * Math.cos(check(a2)) * Math.sin(check(dlon / 2)) ** 2;
  return 6371.0 * 2 * Math.asin(Math.sqrt(a));
}

r.path('<int:listing_id>/availability/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const roomId = q1(req, 'room_id');
    if (roomId) {
      const pk = ormPk(roomId);
      const room = pk === null ? undefined : await db.selectFrom('listings_hotelroom').selectAll().where('id', '=', pk)
        .where('listing_id', '=', listing.id).where('is_active', '=', true).executeTakeFirst();
      if (!room) throw notFoundFor('HotelRoom');
      const bookings = await db.selectFrom('bookings_booking').select(['start_date', 'end_date']).where('hotel_room_id', '=', room.id)
        .where('status', 'in', BOOKING_ACTIVE_STATUSES).orderBy('requested_at', 'desc').execute();
      const counts = new Map<number, number>();
      for (const b of bookings) for (let d = dayNumber(String(b.start_date)); d < dayNumber(String(b.end_date)); d++) counts.set(d, (counts.get(d) ?? 0) + 1);
      return { booked_dates: [...counts].filter(([, c]) => c >= room.total_count).map(([d]) => dayToIso(d)) };
    }
    const bookings = await db.selectFrom('bookings_booking').select(['start_date', 'end_date']).where('hotel_room_id', 'is', null)
      .where('listing_id', '=', listing.id).where('status', 'in', BOOKING_ACTIVE_STATUSES).orderBy('requested_at', 'desc').execute();
    const out: string[] = [];
    for (const b of bookings) for (let d = dayNumber(String(b.start_date)); d < dayNumber(String(b.end_date)); d++) out.push(dayToIso(d));
    return { booked_dates: out };
  },
}));

function datesParams(req: Request): [string, string] {
  const s = q1(req, 'start_date'); const e = q1(req, 'end_date');
  if (!s || !e) throw err(400, { error: 'start_date and end_date are required' });
  const start = dateFromIsoformat(s); const end = dateFromIsoformat(e);
  if (!start || !end) throw err(400, { error: 'Invalid date format. Use YYYY-MM-DD' });
  return [start, end];
}

r.path('<int:listing_id>/pricing/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const [start, end] = datesParams(req);
    if (dayNumber(end) <= dayNumber(start)) throw err(400, { error: 'end_date must be after start_date' });
    let room = null;
    const roomId = q1(req, 'room_id');
    if (roomId) {
      const pk = ormPk(roomId);
      room = pk === null ? null : (await db.selectFrom('listings_hotelroom').selectAll().where('id', '=', pk).where('listing_id', '=', listing.id)
        .where('is_active', '=', true).executeTakeFirst()) ?? null;
    }
    const p = await computeListingPricing(listing, start, end, room);
    return {
      pricing_type: p.pricing_type ?? 'nightly', nights: p.nights, base_price: p.base_price,
      monthly_price: p.monthly_price ?? null, months_upfront: p.months_upfront ?? null, payment_schedule: p.payment_schedule ?? null,
      subtotal: pyRound(p.subtotal, 2), discount: pyRound(p.discount, 2), discount_label: p.discount_label,
      discounted_subtotal: pyRound(p.discounted_subtotal, 2), cleaning_fee: pyRound(p.cleaning_fee, 2), service_fee: pyRound(p.service_fee, 2),
      taxes: pyRound(p.taxes, 2), total: pyRound(p.total, 2),
    };
  },
}));

r.path('analytics/platform-stats/', apiView({
  async GET() {
    const n = async (q: Promise<{ n: unknown } | undefined>) => Number((await q)?.n ?? 0);
    return {
      total_properties: await n(db.selectFrom('listings_listing').select((eb) => eb.fn.countAll().as('n')).where('is_available', '=', true).executeTakeFirst()),
      total_locations: await n(db.selectFrom('listings_listing').select(sql`COUNT(DISTINCT address)`.as('n')).where('is_available', '=', true).where('address', '!=', '').executeTakeFirst()),
      happy_guests: await n(db.selectFrom('listings_review').select(sql`COUNT(DISTINCT reviewer_id)`.as('n')).executeTakeFirst()),
    };
  },
}));

// ---- hotel rooms -----------------------------------------------------------------------------------------

async function roomOr404(listingId: number, roomId: unknown) {
  const pk = pkParam(roomId);
  const room = pk === null ? undefined : await db.selectFrom('listings_hotelroom').selectAll().where('id', '=', pk).where('listing_id', '=', listingId).executeTakeFirst();
  if (!room) throw notFoundFor('HotelRoom');
  return room;
}
const canManage = (req: ApiRequest, listing: ListingRow) => !!req.user && (listing.owner_id === req.user.id || req.user.is_superuser);

r.path('<int:listing_id>/rooms/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    let q = db.selectFrom('listings_hotelroom').selectAll().where('listing_id', '=', listing.id);
    if (!canManage(req, listing)) q = q.where('is_active', '=', true);
    return serializeRooms(await q.orderBy('room_type').orderBy('price_per_night').execute());
  },
  async POST(req, res) {
    const listing = await listingOr404(req.params.listing_id);
    if (!req.user) throw authRequired();
    if (!canManage(req, listing)) return res.status(403).json({ error: 'Permission denied' });
    const { data } = await parseRequest(req, res);
    let dict: Record<string, unknown>;
    // {**request.data} on a QueryDict (a dict subclass) copies the raw lists, not the last values.
    if (data instanceof QueryDict) dict = Object.fromEntries(data.keys().map((k) => [k, data.getlist(k)]));
    else if (data && typeof data === 'object' && !Array.isArray(data)) dict = { ...(data as Record<string, unknown>) };
    else throw new TypeError(`'${pyTypeName(data)}' object is not a mapping`);
    dict.listing = listing.id;
    const v = await runSerializer(dict, HOTEL_ROOM_FIELDS);
    if (v.errors) return res.status(400).json(v.errors);
    const room = await createHotelRoom(v.values, listing.id);
    return res.status(201).json(serializeRoom(room, []));
  },
}));

r.path('<int:listing_id>/rooms/<int:room_id>/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    return (await serializeRooms([room]))[0];
  },
  async PUT(req, res) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    if (!req.user) throw authRequired();
    if (!canManage(req, listing)) return res.status(403).json({ error: 'Permission denied' });
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, HOTEL_ROOM_FIELDS, { partial: true });
    if (v.errors) return res.status(400).json(v.errors);
    const set: Record<string, unknown> = { ...v.values };
    if (set.listing) { set.listing_id = (set.listing as ListingRow).id; delete set.listing; }
    if ('amenities' in set) set.amenities = JSON.stringify(set.amenities);
    const saved = Object.keys(set).length
      ? await db.updateTable('listings_hotelroom').set(set as never).where('id', '=', room.id).returningAll().executeTakeFirstOrThrow()
      : room;
    return (await serializeRooms([saved]))[0];
  },
  async DELETE(req, res) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    if (!req.user) throw authRequired();
    if (!canManage(req, listing)) return res.status(403).json({ error: 'Permission denied' });
    await db.transaction().execute((trx) => deleteHotelRooms([room.id], trx));
    return res.status(204).json({ message: 'Room deleted' });
  },
}));

r.path('<int:listing_id>/rooms/availability/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const [start, end] = datesParams(req);
    const rooms = await db.selectFrom('listings_hotelroom').selectAll().where('listing_id', '=', listing.id).where('is_active', '=', true)
      .orderBy('room_type').orderBy('price_per_night').execute();
    const ser = await serializeRooms(rooms);
    const out = [];
    for (const [i, room] of rooms.entries()) out.push({ ...ser[i]!, available_count: await getAvailableRoomCount(room, start, end) });
    return out;
  },
}));

r.path('<int:listing_id>/rooms/<int:room_id>/images/', apiView({
  async GET(req) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    const imgs = await db.selectFrom('listings_hotelroomimage').selectAll().where('room_id', '=', room.id).orderBy('order').execute();
    return imgs.map((i) => serializeGalleryImage(i, null));
  },
  async POST(req, res) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    if (!req.user) throw authRequired();
    if (!canManage(req, listing)) return res.status(403).json({ error: 'Only the owner can add room images' });
    const { data, files } = await parseRequest(req, res, ['multipart', 'form']);
    checkImageSize(files);
    const v = await runSerializer(data, IMAGE_FIELDS);
    if (v.errors) return res.status(400).json(v.errors);
    const { m } = await db.selectFrom('listings_hotelroomimage').select((eb) => eb.fn.max('order').as('m')).where('room_id', '=', room.id).executeTakeFirstOrThrow();
    const order = (m ? Number(m) : 0) + 1;
    const name = await saveUpload('listings/rooms/', (v.values.image as Upload).name, (v.values.image as Upload).data);
    const img = await db.insertInto('listings_hotelroomimage').values({
      room_id: room.id, image: name, caption: (v.values.caption as string | undefined) ?? '', order, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    return res.status(201).json(serializeGalleryImage(img, null));
  },
}));

r.path('<int:listing_id>/rooms/<int:room_id>/images/<int:image_id>/', apiView({
  async DELETE(req, res) {
    const listing = await listingOr404(req.params.listing_id);
    const room = await roomOr404(listing.id, req.params.room_id);
    const pk = pkParam(req.params.image_id);
    const image = pk === null ? undefined : await db.selectFrom('listings_hotelroomimage').selectAll().where('id', '=', pk).where('room_id', '=', room.id).executeTakeFirst();
    if (!image) throw notFoundFor('HotelRoomImage');
    if (!req.user) throw authRequired();
    if (!canManage(req, listing)) return res.status(403).json({ error: 'Only the owner can delete room images' });
    await db.deleteFrom('listings_hotelroomimage').where('id', '=', image.id).execute();
    return res.status(204).json({ message: 'Image deleted' });
  },
}));

void isUpload; void pyFloatRepr;
