// listings.views.compute_listing_pricing / _get_available_room_count (also used by bookings & payments).

import { db } from '../../db/index.js';
import { getServiceFeeRate } from '../../domain/payments.js';
import { dayNumber, todayIso } from './drf.js';
import type { Executor, HotelRoomRow, ListingRow } from './serializers.js';

export const MONTHS_PER_SCHEDULE: Record<string, number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };
export const BOOKING_ACTIVE_STATUSES = ['pending_host', 'awaiting_payment', 'payment_received', 'confirmed', 'requested', 'payment_requested', 'pending'];

export interface Pricing {
  pricing_type: 'nightly' | 'monthly';
  nights: number;
  base_price: number;
  monthly_price?: number;
  months_upfront?: number;
  payment_schedule?: string;
  subtotal: number;
  discount: number;
  discount_label: string | null;
  discounted_subtotal: number;
  cleaning_fee: number;
  service_fee: number;
  taxes: number;
  total: number;
}

type PricingListing = Pick<ListingRow, 'pricing_type' | 'payment_schedule' | 'price' | 'weekend_premium_percent' | 'monthly_discount_enabled'
  | 'monthly_discount_percent' | 'weekly_discount_enabled' | 'weekly_discount_percent' | 'last_minute_discount_enabled' | 'last_minute_discount_percent'>;

/** compute_listing_pricing(listing, start, end, room=None) — dates as 'YYYY-MM-DD' (start/end may be null for monthly). */
export async function computeListingPricing(listing: PricingListing, start: string | null, end: string | null, room: Pick<HotelRoomRow, 'price_per_night'> | null = null, ex: Executor = db): Promise<Pricing> {
  const feeRate = Number((await getServiceFeeRate(ex)).toString());
  if (room === null && (listing.pricing_type ?? 'nightly') === 'monthly') {
    const schedule = listing.payment_schedule || 'monthly';
    const monthsUpfront = MONTHS_PER_SCHEDULE[schedule] ?? 1;
    const monthlyPrice = Number(listing.price);
    const subtotal = monthlyPrice * monthsUpfront;
    const serviceFee = subtotal * feeRate;
    return {
      pricing_type: 'monthly',
      nights: start && end ? dayNumber(end) - dayNumber(start) : 0,
      base_price: monthlyPrice, monthly_price: monthlyPrice, months_upfront: monthsUpfront, payment_schedule: schedule,
      subtotal, discount: 0, discount_label: null, discounted_subtotal: subtotal, cleaning_fee: 0, service_fee: serviceFee,
      taxes: 0, total: subtotal + serviceFee,
    };
  }
  const s = dayNumber(start!);
  const nights = dayNumber(end!) - s;
  const basePrice = room ? Number(room.price_per_night) : Number(listing.price);
  const weekendPremium = listing.weekend_premium_percent / 100.0;
  let subtotal = 0.0;
  for (let i = 0; i < nights; i++) {
    const day = s + i;
    const weekday = (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday (weekday 3)
    subtotal += weekday >= 4 ? basePrice * (1 + weekendPremium) : basePrice;
  }
  let discount = 0.0;
  let label: string | null = null;
  if (nights >= 28 && listing.monthly_discount_enabled) {
    discount = (subtotal * listing.monthly_discount_percent) / 100;
    label = `${listing.monthly_discount_percent}% monthly discount`;
  } else if (nights >= 7 && listing.weekly_discount_enabled) {
    discount = (subtotal * listing.weekly_discount_percent) / 100;
    label = `${listing.weekly_discount_percent}% weekly discount`;
  } else if (listing.last_minute_discount_enabled) {
    const daysUntil = s - dayNumber(todayIso());
    if (daysUntil <= 3) {
      discount = (subtotal * listing.last_minute_discount_percent) / 100;
      label = `${listing.last_minute_discount_percent}% last-minute discount`;
    }
  }
  const discounted = subtotal - discount;
  const serviceFee = discounted * feeRate;
  return {
    pricing_type: 'nightly', nights, base_price: basePrice, subtotal, discount, discount_label: label,
    discounted_subtotal: discounted, cleaning_fee: 0.0, service_fee: serviceFee, taxes: 0.0, total: discounted + serviceFee,
  };
}

/** _get_available_room_count(room, start_date, end_date) */
export async function getAvailableRoomCount(room: Pick<HotelRoomRow, 'id' | 'total_count'>, startDate: string, endDate: string, ex: Executor = db): Promise<number> {
  const { n } = await ex.selectFrom('bookings_booking').select((eb) => eb.fn.countAll<number>().as('n'))
    .where('hotel_room_id', '=', room.id).where('status', 'in', BOOKING_ACTIVE_STATUSES)
    .where('start_date', '<', endDate).where('end_date', '>', startDate).executeTakeFirstOrThrow();
  return Math.max(0, room.total_count - Number(n));
}
