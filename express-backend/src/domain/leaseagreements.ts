// leaseagreements.agreements — what other apps import.
//   generateLeaseForBooking(booking, ex) is what domain/notifications.ts
//   (notify_booking_submitted) loads dynamically.

export {
  CURRENT_LEASE_VERSION, LEASE_TITLE, isLongTerm, buildContext, generateLeaseForBooking, recordAcceptance,
} from '../apps/leaseagreements/agreements.js';
export type { LeaseRow, AcceptanceRow } from '../apps/leaseagreements/agreements.js';
export { renderLeasePdf } from '../apps/leaseagreements/pdf.js';
export { serializeLease } from '../apps/leaseagreements/serializers.js';
