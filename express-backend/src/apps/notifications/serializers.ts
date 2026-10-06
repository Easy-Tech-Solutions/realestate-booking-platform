// notifications.serializers

import type { Selectable } from 'kysely';
import type { NotificationsNotification, NotificationsNotificationpreference } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';

/** NotificationSerializer (all fields read-only). */
export function serializeNotification(n: Selectable<NotificationsNotification>) {
  return {
    id: n.id,
    notification_type: n.notification_type,
    title: n.title,
    message: n.message,
    data: n.data,
    is_read: n.is_read,
    email_sent: n.email_sent,
    created_at: drf(n.created_at),
    read_at: drf(n.read_at),
  };
}

/** NotificationPreferenceSerializer.Meta.fields (writable ones; updated_at is read-only). */
export const PREFERENCE_SERIALIZER_FIELDS = [
  'booking_requested_email',
  'booking_confirmed_email',
  'booking_declined_email',
  'booking_cancelled_email',
  'booking_completed_email',
  'payment_received_email',
  'payment_failed_email',
  'payment_refunded_email',
  'new_message_email',
  'price_changed_email',
  'listing_available_email',
  'search_alert_email',
  'new_review_email',
  'in_app_enabled',
] as const;

export function serializePreferences(p: Selectable<NotificationsNotificationpreference>) {
  const out: Record<string, unknown> = {};
  for (const f of PREFERENCE_SERIALIZER_FIELDS) out[f] = p[f];
  out.updated_at = drf(p.updated_at);
  return out;
}

const TRUE_VALUES = new Set<unknown>(['t', 'y', 'yes', 'true', 'on', '1', 1, true]);
const FALSE_VALUES = new Set<unknown>(['f', 'n', 'no', 'false', 'off', '0', 0, false]);

/**
 * DRF BooleanField.run_validation for a non-null field: returns the boolean
 * or an error message. Strings are lowercased; 1.0/0.0 hash like 1/0 in Python.
 */
export function drfBoolean(value: unknown): { ok: true; value: boolean } | { ok: false; error: string } {
  if (value === null) return { ok: false, error: 'This field may not be null.' };
  const v = typeof value === 'string' ? value.toLowerCase() : value;
  if (TRUE_VALUES.has(v)) return { ok: true, value: true };
  if (FALSE_VALUES.has(v)) return { ok: true, value: false };
  return { ok: false, error: 'Must be a valid boolean.' };
}
