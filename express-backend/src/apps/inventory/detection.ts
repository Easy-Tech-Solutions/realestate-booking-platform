// inventory.detection — rule-based listing-moderation detectors.

import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { delayAiScoring } from '../../domain/aiscoring.js';
import { pyFixed, pyRound } from '../listings/drf.js';
import { likeContains } from '../listings/filters.js';
import { pyFloatRepr, pyRepr } from '../../lib/py.js';

const DUPLICATE_GRID_PRECISION = 3;

async function openFlagExists(flagType: string, signal: string) {
  return !!(await db.selectFrom('inventory_listingflag').select('id').where('flag_type', '=', flagType).where('status', '=', 'open')
    .where(sql<boolean>`"details"::text LIKE ${likeContains(signal)}`).limit(1).executeTakeFirst());
}

export async function createListingFlag(values: { listing_id: number | null; flag_type: string; severity: string; details: string }) {
  const flag = await db.insertInto('inventory_listingflag').values({
    ...values, status: 'open', ai_score: null, ai_rationale: '', reviewed_by_id: null, reviewed_at: null, review_notes: '', created_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  return flag;
}

interface Cand { id: number; title: string; latitude: string | null; longitude: string | null; property_type: string; owner_username: string; price: string; city: string }

/** str(float) */
const fstr = (x: number) => pyFloatRepr(x);
/** Python round(x, n) key as a repr string (dict-key identity). */
const roundKey = (x: number) => fstr(pyRound(x, DUPLICATE_GRID_PRECISION));

export async function detectDuplicateListings(minGroupSize = 2) {
  const rows = (await sql<Cand>`SELECT "listings_listing".*, "users_user"."username" AS "owner_username" FROM "listings_listing"
    INNER JOIN "users_user" ON ("listings_listing"."owner_id" = "users_user"."id")
    WHERE ("listings_listing"."deleted_at" IS NULL AND "listings_listing"."latitude" IS NOT NULL AND "listings_listing"."longitude" IS NOT NULL
      AND "listings_listing"."status" IN ('pending_review', 'published'))`.execute(db)).rows;
  const groups = new Map<string, { ptype: string; listings: Cand[] }>();
  for (const l of rows) {
    const key = JSON.stringify([roundKey(Number(l.latitude)), roundKey(Number(l.longitude)), l.property_type]);
    if (!groups.has(key)) groups.set(key, { ptype: l.property_type, listings: [] });
    groups.get(key)!.listings.push(l);
  }
  const created = [];
  for (const { ptype, listings } of groups.values()) {
    if (listings.length < minGroupSize) continue;
    const ids = listings.map((l) => l.id).sort((a, b) => a - b);
    const idsStr = `[${ids.join(', ')}]`;
    if (await openFlagExists('duplicate', idsStr)) continue;
    const titles = listings.map((l) => `#${l.id} "${l.title}" (owner: ${l.owner_username})`).join(', ');
    const flag = await createListingFlag({
      listing_id: listings[0]!.id, flag_type: 'duplicate', severity: 'medium',
      details: `${listings.length} listings at nearly the same location (${ptype}) — listing IDs ${idsStr}: ${titles}`,
    });
    created.push(flag);
    await delayAiScoring('score_listing_flag_task', flag.id);
  }
  return created;
}

/** statistics.median */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export async function detectPriceAnomalies(minSamples = 5, zThreshold = 3.5) {
  const rows = (await sql<Cand>`SELECT "listings_listing".* FROM "listings_listing"
    WHERE ("listings_listing"."deleted_at" IS NULL AND "listings_listing"."price" > 0 AND "listings_listing"."status" IN ('pending_review', 'published')
      AND NOT ("listings_listing"."city" = '' AND "listings_listing"."city" IS NOT NULL))`.execute(db)).rows;
  const groups = new Map<string, { city: string; listings: Cand[] }>();
  for (const l of rows) {
    const key = JSON.stringify([l.city, l.property_type]);
    if (!groups.has(key)) groups.set(key, { city: l.city, listings: [] });
    groups.get(key)!.listings.push(l);
  }
  const created = [];
  for (const { city, listings } of groups.values()) {
    if (listings.length < minSamples) continue;
    const prices = listings.map((l) => Number(l.price));
    const med = median(prices);
    const mad = median(prices.map((p) => Math.abs(p - med)));
    for (const [i, listing] of listings.entries()) {
      const price = prices[i]!;
      let explanation: string;
      if (mad === 0) {
        if (med === 0 || !(price >= med * 5 || price <= med / 5)) continue;
        explanation = `${fstr(price)} vs city/type median ${pyFixed(med, 2)} (ratio ${pyFixed(price / med, 1)}x)`;
      } else {
        const z = (0.6745 * (price - med)) / mad;
        if (Math.abs(z) < zThreshold) continue;
        explanation = `${fstr(price)} vs city/type median ${pyFixed(med, 2)} (MAD ${pyFixed(mad, 2)}) — robust z-score ${pyFixed(z, 2)}`;
      }
      const signal = `listing #${listing.id}`;
      if (await openFlagExists('price_anomaly', signal)) continue;
      const high = price >= med * 8 || (med !== 0 && price <= med / 8);
      const flag = await createListingFlag({
        listing_id: listing.id, flag_type: 'price_anomaly', severity: high ? 'high' : 'medium',
        details: `listing #${listing.id} "${listing.title}" priced ${explanation} across ${listings.length} comparable listings in ${city}`,
      });
      created.push(flag);
      await delayAiScoring('score_listing_flag_task', flag.id);
    }
  }
  return created;
}

export async function runAllDetectors() {
  return { duplicate_listings: await detectDuplicateListings(), price_anomalies: await detectPriceAnomalies() };
}

void pyRepr;
