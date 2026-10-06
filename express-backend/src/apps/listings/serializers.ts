// listings.serializers — output representations (ListingSerializer, HotelRoomSerializer,
// image serializers, FavoriteSerializer, ReviewSerializer) and the writable field specs
// (ListingSerializer / HotelRoomSerializer / ReviewSerializer / ReviewCreateSerializer).

import type { Request } from 'express';
import { sql, type Selectable, type Transaction } from 'kysely';
import { db, type DB } from '../../db/index.js';
import type {
  ListingsHotelroom, ListingsHotelroomimage, ListingsListing, ListingsListingimage, ListingsReview,
} from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import { mediaUrl } from '../../domain/users.js';
import { Dec } from '../notifications/decimal.js';
import { FieldError, pyRound, type Fields } from './drf.js';

export type Executor = typeof db | Transaction<DB>;
export type ListingRow = Selectable<ListingsListing>;
export type HotelRoomRow = Selectable<ListingsHotelroom>;
export type ReviewRow = Selectable<ListingsReview>;

// ---- choices --------------------------------------------------------------------------

export const PRIVACY_TYPES = ['entire_place', 'private_room', 'shared_room'];
export const BOOKING_MODES = ['instant', 'approve_first'];
export const CANCELLATION_POLICIES = ['flexible', 'moderate', 'strict', 'super_strict'];
export const LISTING_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'suspended'];
export const PRICING_TYPES = ['nightly', 'monthly'];
export const PAYMENT_SCHEDULES = ['monthly', 'quarterly', 'biannual', 'annual'];
export const ROOM_TYPES = ['standard', 'deluxe', 'suite', 'family', 'studio', 'penthouse'];
export const BED_TYPES = ['king', 'queen', 'twin', 'double', 'single', 'bunk'];

// ---- small serializers ------------------------------------------------------------------

/** ListingImageSerializer / HotelRoomImageSerializer (image is absolute only with a request in context). */
export function serializeGalleryImage(img: Selectable<ListingsListingimage> | Selectable<ListingsHotelroomimage>, req: Request | null) {
  return { id: img.id, image: fileUrl(req, img.image), image_url: mediaUrl(img.image), caption: img.caption, order: img.order };
}

/** ListingImageCreateSerializer (fields image, caption, order; no request in context). */
export function serializeListingImageCreate(img: Selectable<ListingsListingimage>) {
  return { image: mediaUrl(img.image), caption: img.caption, order: img.order };
}

export async function roomImages(roomIds: number[], ex: Executor = db) {
  const by = new Map<number, Selectable<ListingsHotelroomimage>[]>();
  if (!roomIds.length) return by;
  const rows = await ex.selectFrom('listings_hotelroomimage').selectAll().where('room_id', 'in', roomIds).orderBy('order').execute();
  for (const r of rows) { if (!by.has(r.room_id)) by.set(r.room_id, []); by.get(r.room_id)!.push(r); }
  return by;
}

/** HotelRoomSerializer (always used without a request → relative image URLs). */
export function serializeRoom(room: HotelRoomRow, images: Selectable<ListingsHotelroomimage>[]) {
  return {
    id: room.id, listing: room.listing_id, name: room.name, room_type: room.room_type, description: room.description,
    price_per_night: room.price_per_night, max_occupancy: room.max_occupancy, beds: room.beds, bed_type: room.bed_type,
    bathrooms: room.bathrooms, amenities: room.amenities, total_count: room.total_count, is_active: room.is_active,
    created_at: drf(room.created_at), images: images.map((i) => serializeGalleryImage(i, null)),
  };
}

export async function serializeRooms(rooms: HotelRoomRow[], ex: Executor = db) {
  const imgs = await roomImages(rooms.map((r) => r.id), ex);
  return rooms.map((r) => serializeRoom(r, imgs.get(r.id) ?? []));
}

// ---- ListingSerializer --------------------------------------------------------------------

/** float(AVG(rating)) as Django hands it back, then round(x, 2) if truthy. */
function averageRating(avg: unknown): number | null {
  if (avg === null || avg === undefined) return null;
  const f = Number(avg);
  return f ? pyRound(f, 2) : null;
}

/**
 * ListingSerializer(many=True, context={'request': req}).data for already-loaded rows.
 * `aggs` carries the _optimize_listings() annotations when the queryset had them;
 * otherwise they're computed per listing like get_average_rating/get_review_count do.
 */
export async function serializeListings(rows: ListingRow[], req: Request | null, ex: Executor = db) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const [owners, profiles, gallery, rooms, aggs] = await Promise.all([
    ex.selectFrom('users_user').select(['id', 'username', 'first_name', 'last_name']).where('id', 'in', ownerIds).execute(),
    ex.selectFrom('users_profile').select(['user_id', 'image', 'is_superhost']).where('user_id', 'in', ownerIds).execute(),
    ex.selectFrom('listings_listingimage').selectAll().where('listing_id', 'in', ids).orderBy('order').execute(),
    ex.selectFrom('listings_hotelroom').selectAll().where('is_active', '=', true).where('listing_id', 'in', ids)
      .orderBy('room_type').orderBy('price_per_night').execute(),
    ex.selectFrom('listings_review').select(['listing_id', sql<string | null>`AVG(rating)`.as('avg'), sql<number>`COUNT(DISTINCT id)`.as('cnt')])
      .where('listing_id', 'in', ids).groupBy('listing_id').execute(),
  ]);
  const ownerBy = new Map(owners.map((o) => [o.id, o]));
  const profBy = new Map(profiles.map((p) => [p.user_id, p]));
  const galBy = new Map<number, typeof gallery>();
  for (const g of gallery) { if (!galBy.has(g.listing_id)) galBy.set(g.listing_id, []); galBy.get(g.listing_id)!.push(g); }
  const roomBy = new Map<number, HotelRoomRow[]>();
  for (const r of rooms) { if (!roomBy.has(r.listing_id)) roomBy.set(r.listing_id, []); roomBy.get(r.listing_id)!.push(r); }
  const imgs = await roomImages(rooms.map((r) => r.id), ex);
  const aggBy = new Map(aggs.map((a) => [a.listing_id, a]));

  return rows.map((l) => {
    const owner = ownerBy.get(l.owner_id)!;
    const prof = profBy.get(l.owner_id);
    const agg = aggBy.get(l.id);
    return {
      id: l.id, title: l.title, description: l.description, price: l.price, property_type: l.property_type,
      privacy_type: l.privacy_type, address: l.address, city: l.city, state: l.state, country: l.country,
      latitude: l.latitude, longitude: l.longitude, check_in_time: l.check_in_time, check_out_time: l.check_out_time,
      self_checkin: l.self_checkin, square_footage: l.square_footage, bedrooms: l.bedrooms, beds: l.beds,
      bathrooms: l.bathrooms, max_guests: l.max_guests, amenities: l.amenities, highlights: l.highlights,
      booking_mode: l.booking_mode, cancellation_policy: l.cancellation_policy,
      weekend_premium_percent: l.weekend_premium_percent, new_listing_promo: l.new_listing_promo,
      last_minute_discount_enabled: l.last_minute_discount_enabled, last_minute_discount_percent: l.last_minute_discount_percent,
      weekly_discount_enabled: l.weekly_discount_enabled, weekly_discount_percent: l.weekly_discount_percent,
      monthly_discount_enabled: l.monthly_discount_enabled, monthly_discount_percent: l.monthly_discount_percent,
      exterior_camera: l.exterior_camera, noise_monitor: l.noise_monitor, weapons_on_property: l.weapons_on_property,
      pricing_type: l.pricing_type, payment_schedule: l.payment_schedule, lease_term_months: l.lease_term_months,
      is_available: l.is_available, status: l.status, created_at: drf(l.created_at), updated_at: drf(l.updated_at),
      gallery_images: (galBy.get(l.id) ?? []).map((g) => serializeGalleryImage(g, req)),
      hotel_rooms: (roomBy.get(l.id) ?? []).map((r) => serializeRoom(r, imgs.get(r.id) ?? [])),
      main_image: fileUrl(req, l.main_image),
      main_image_url: mediaUrl(l.main_image),
      owner_username: owner.username, owner_id: owner.id, owner_first_name: owner.first_name, owner_last_name: owner.last_name,
      owner_avatar: prof ? mediaUrl(prof.image) : null,
      owner_is_superhost: prof ? prof.is_superhost : false,
      average_rating: averageRating(agg?.avg ?? null),
      review_count: agg ? Number(agg.cnt) : 0,
      suspension_reason: l.suspension_reason, suspended_at: drf(l.suspended_at),
      local_registration_number: l.local_registration_number, occupancy_cap: l.occupancy_cap,
    };
  });
}

export async function serializeListing(row: ListingRow, req: Request | null, ex: Executor = db) {
  return (await serializeListings([row], req, ex))[0]!;
}

// ---- FavoriteSerializer ---------------------------------------------------------------------

export async function serializeFavorites(favs: { id: number; listing_id: number; created_at: string }[], req: Request | null, ex: Executor = db) {
  if (!favs.length) return [];
  const listings = await ex.selectFrom('listings_listing').selectAll().where('id', 'in', [...new Set(favs.map((f) => f.listing_id))]).execute();
  const ser = await serializeListings(listings, req, ex);
  const by = new Map(ser.map((s) => [s.id, s]));
  return favs.map((f) => ({ id: f.id, listing_id: f.listing_id, listing: by.get(f.listing_id)!, created_at: drf(f.created_at) }));
}

// ---- ReviewSerializer ---------------------------------------------------------------------------

export async function serializeReviews(reviews: ReviewRow[], req: Request | null, ex: Executor = db) {
  if (!reviews.length) return [];
  const userIds = [...new Set(reviews.map((r) => r.reviewer_id))];
  const listingIds = [...new Set(reviews.map((r) => r.listing_id))];
  const [users, profiles, listings, images] = await Promise.all([
    ex.selectFrom('users_user').select(['id', 'username', 'first_name', 'last_name']).where('id', 'in', userIds).execute(),
    ex.selectFrom('users_profile').select(['user_id', 'image']).where('user_id', 'in', userIds).execute(),
    ex.selectFrom('listings_listing').select(['id', 'title']).where('id', 'in', listingIds).execute(),
    ex.selectFrom('listings_reviewimage').selectAll().where('review_id', 'in', reviews.map((r) => r.id)).orderBy('id').execute(),
  ]);
  const uBy = new Map(users.map((u) => [u.id, u]));
  const pBy = new Map(profiles.map((p) => [p.user_id, p]));
  const lBy = new Map(listings.map((l) => [l.id, l]));
  return reviews.map((r) => {
    const u = uBy.get(r.reviewer_id)!;
    const p = pBy.get(r.reviewer_id);
    return {
      id: r.id, listing: r.listing_id, listing_title: lBy.get(r.listing_id)!.title, reviewer: r.reviewer_id,
      reviewer_username: u.username, reviewer_first_name: u.first_name, reviewer_last_name: u.last_name,
      reviewer_avatar: p ? mediaUrl(p.image) : null,
      rating: r.rating, cleanliness: r.cleanliness, accuracy: r.accuracy, check_in_rating: r.check_in_rating,
      communication: r.communication, location_rating: r.location_rating, value: r.value,
      title: r.title, content: r.content, host_response: r.host_response, host_response_at: drf(r.host_response_at),
      is_verified: r.is_verified, created_at: drf(r.created_at), updated_at: drf(r.updated_at),
      images: images.filter((i) => i.review_id === r.id).map((i) => ({
        id: i.id, image: fileUrl(req, i.image), image_url: mediaUrl(i.image), caption: i.caption, created_at: drf(i.created_at),
      })),
    };
  });
}

// ---- writable field specs --------------------------------------------------------------------------

const INT32 = { minValue: -2147483648, maxValue: 2147483647 };
const UINT32 = { minValue: 0, maxValue: 2147483647 };

function normalizeListField(value: unknown, fieldName: string): unknown {
  if (value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new FieldError([`${fieldName} must be a valid JSON array.`]); }
    if (Array.isArray(parsed)) return parsed;
    throw new FieldError([`${fieldName} must be a list.`]);
  }
  throw new FieldError([`${fieldName} must be a list.`]);
}

async function validatePropertyType(value: unknown): Promise<unknown> {
  const slug = String(value ?? '').trim().toLowerCase();
  if (!slug) return 'apartment';
  const hit = await db.selectFrom('listings_propertycategory').select('id').where('slug', '=', slug).where('is_active', '=', true).executeTakeFirst();
  if (!hit) {
    const active = await db.selectFrom('listings_propertycategory').select('slug').where('is_active', '=', true)
      .orderBy('sort_order').orderBy('name').execute();
    throw new FieldError([`Invalid property_type '${value}'. Valid options are: ${active.map((a) => a.slug).join(', ')}`]);
  }
  return slug;
}

/** ListingSerializer writable fields, in Meta.fields order. */
export const LISTING_FIELDS: Fields = [
  ['title', { kind: 'char', required: false, allowBlank: true, maxLength: 200 }],
  ['description', { kind: 'char', required: false, allowBlank: true }],
  ['price', { kind: 'decimal', required: false, maxDigits: 12, decimalPlaces: 2 }],
  ['property_type', { kind: 'char', required: false, maxLength: 50, validate: validatePropertyType }],
  ['privacy_type', { kind: 'choice', required: false, choices: PRIVACY_TYPES }],
  ['address', { kind: 'char', required: false, allowBlank: true, maxLength: 200 }],
  ['city', { kind: 'char', required: false, allowBlank: true, maxLength: 100 }],
  ['state', { kind: 'char', required: false, allowBlank: true, maxLength: 100 }],
  ['country', { kind: 'char', required: false, allowBlank: true, maxLength: 100 }],
  ['latitude', { kind: 'decimal', required: false, allowNull: true, maxDigits: 9, decimalPlaces: 6 }],
  ['longitude', { kind: 'decimal', required: false, allowNull: true, maxDigits: 9, decimalPlaces: 6 }],
  ['check_in_time', { kind: 'char', required: false, maxLength: 10 }],
  ['check_out_time', { kind: 'char', required: false, maxLength: 10 }],
  ['self_checkin', { kind: 'bool', required: false }],
  ['square_footage', { kind: 'int', required: false, ...INT32 }],
  ['bedrooms', { kind: 'int', required: false, ...INT32 }],
  ['beds', { kind: 'int', required: false, ...INT32 }],
  ['bathrooms', { kind: 'int', required: false, ...INT32 }],
  ['max_guests', { kind: 'int', required: false, ...INT32 }],
  ['amenities', { kind: 'json', required: false, validate: (v) => normalizeListField(v, 'amenities') }],
  ['highlights', { kind: 'json', required: false, validate: (v) => normalizeListField(v, 'highlights') }],
  ['booking_mode', { kind: 'choice', required: false, choices: BOOKING_MODES }],
  ['cancellation_policy', { kind: 'choice', required: false, choices: CANCELLATION_POLICIES }],
  ['weekend_premium_percent', { kind: 'int', required: false, ...INT32 }],
  ['new_listing_promo', { kind: 'bool', required: false }],
  ['last_minute_discount_enabled', { kind: 'bool', required: false }],
  ['last_minute_discount_percent', { kind: 'int', required: false, ...INT32 }],
  ['weekly_discount_enabled', { kind: 'bool', required: false }],
  ['weekly_discount_percent', { kind: 'int', required: false, ...INT32 }],
  ['monthly_discount_enabled', { kind: 'bool', required: false }],
  ['monthly_discount_percent', { kind: 'int', required: false, ...INT32 }],
  ['exterior_camera', { kind: 'bool', required: false }],
  ['noise_monitor', { kind: 'bool', required: false }],
  ['weapons_on_property', { kind: 'bool', required: false }],
  ['pricing_type', { kind: 'choice', required: false, choices: PRICING_TYPES }],
  ['payment_schedule', { kind: 'choice', required: false, allowNull: true, allowBlank: true, choices: PAYMENT_SCHEDULES }],
  ['lease_term_months', { kind: 'int', required: false, allowNull: true, minValue: 1, maxValue: 2147483647 }],
  ['is_available', { kind: 'bool', required: false }],
  ['status', { kind: 'choice', required: false, choices: LISTING_STATUSES }],
  ['main_image', { kind: 'image', required: false, allowNull: true, maxLength: 100 }],
];

/** ListingSettings.get_current(): get_or_create(pk=1). */
export async function listingSettings(ex: Executor = db) {
  const row = await ex.selectFrom('listings_listingsettings').selectAll().where('id', '=', 1).executeTakeFirst();
  if (row) return row;
  await ex.insertInto('listings_listingsettings').values({ id: 1, min_monthly_price: '5.00', updated_at: new Date().toISOString() })
    .onConflict((oc) => oc.column('id').doNothing()).execute();
  return ex.selectFrom('listings_listingsettings').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
}

/** ListingSerializer.validate(attrs) */
export function listingValidate(instance: ListingRow | null) {
  return async (attrs: Record<string, unknown>) => {
    if (instance === null && (attrs.status ?? 'published') !== 'draft') {
      if (!String(attrs.title ?? '').trim()) throw new FieldError({ title: 'Title is required' });
      if (!String(attrs.address ?? '').trim()) throw new FieldError({ address: 'Address is required' });
    }
    const cap = instance ? instance.occupancy_cap : null;
    if (cap !== null && 'max_guests' in attrs && (attrs.max_guests as number) > cap) {
      throw new FieldError({ max_guests: `This property is capped at ${cap} guests by local compliance requirements.` });
    }
    if ('price' in attrs && attrs.price !== null && attrs.price !== undefined) {
      const min = (await listingSettings()).min_monthly_price;
      if (Dec.from(attrs.price as string).cmp(min) < 0) throw new FieldError({ price: `Price must be at least $${min}.` });
    }
    return attrs;
  };
}

/** HotelRoomSerializer writable fields. */
export const HOTEL_ROOM_FIELDS: Fields = [
  ['listing', { kind: 'pk', pkTable: 'listings_listing' }],
  ['name', { kind: 'char', maxLength: 120 }],
  ['room_type', { kind: 'choice', required: false, choices: ROOM_TYPES }],
  ['description', { kind: 'char', required: false, allowBlank: true }],
  ['price_per_night', { kind: 'decimal', maxDigits: 12, decimalPlaces: 2 }],
  ['max_occupancy', { kind: 'int', required: false, ...UINT32 }],
  ['beds', { kind: 'int', required: false, ...UINT32 }],
  ['bed_type', { kind: 'choice', required: false, choices: BED_TYPES }],
  ['bathrooms', { kind: 'int', required: false, ...UINT32 }],
  ['amenities', { kind: 'json', required: false }],
  ['total_count', { kind: 'int', required: false, ...UINT32 }],
  ['is_active', { kind: 'bool', required: false }],
];

const RATING_FIELDS: Fields = [
  ['cleanliness', { kind: 'int', required: false, allowNull: true, ...INT32 }],
  ['accuracy', { kind: 'int', required: false, allowNull: true, ...INT32 }],
  ['check_in_rating', { kind: 'int', required: false, allowNull: true, ...INT32 }],
  ['communication', { kind: 'int', required: false, allowNull: true, ...INT32 }],
  ['location_rating', { kind: 'int', required: false, allowNull: true, ...INT32 }],
  ['value', { kind: 'int', required: false, allowNull: true, ...INT32 }],
];

/** ReviewSerializer writable fields (PUT, partial). */
export const REVIEW_FIELDS: Fields = [
  ['listing', { kind: 'pk', pkTable: 'listings_listing' }],
  ['rating', { kind: 'choice', choices: [1, 2, 3, 4, 5] }],
  ...RATING_FIELDS,
  ['title', { kind: 'char', required: false, allowBlank: true, maxLength: 100 }],
  ['content', { kind: 'char' }],
];

/** ReviewCreateSerializer fields. */
export const REVIEW_CREATE_FIELDS: Fields = [
  ['listing', { kind: 'pk', pkTable: 'listings_listing' }],
  ['rating', { kind: 'choice', choices: [1, 2, 3, 4, 5] }],
  ...RATING_FIELDS,
  ['content', { kind: 'char', required: false, allowBlank: true, default: '' }],
  ['title', { kind: 'char', required: false, allowBlank: true, default: '' }],
  ['images', { kind: 'imagelist', required: false }],
];

/** ListingImageCreateSerializer / HotelRoomImageSerializer writable fields. */
export const IMAGE_FIELDS: Fields = [
  ['image', { kind: 'image', maxLength: 100 }],
  ['caption', { kind: 'char', required: false, allowBlank: true, maxLength: 255 }],
  ['order', { kind: 'int', required: false, ...UINT32 }],
];
