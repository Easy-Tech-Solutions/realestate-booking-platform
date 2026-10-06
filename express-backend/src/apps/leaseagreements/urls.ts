// leaseagreements — /api/lease-agreements/ (port of leaseagreements/views.py + urls.py).

import type { Request } from 'express';
import { db } from '../../db/index.js';
import { notFoundFor } from '../../lib/errors.js';
import { IsAuthenticated, negotiatedView, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { lookupId } from '../bookings/py.js';
import { CURRENT_LEASE_VERSION, isLongTerm, recordAcceptance } from './agreements.js';
import { serializeLease } from './serializers.js';

/** get_object_or_404(Booking.objects.select_related('listing'), pk=booking_id) */
async function bookingOr404(raw: unknown) {
  const id = lookupId(raw);
  const b = id === null ? undefined : await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
    .select(['b.id', 'b.customer_id', 'l.owner_id', 'l.pricing_type']).where('b.id', '=', id).executeTakeFirst();
  if (!b) throw notFoundFor('Booking');
  return b;
}

/** _client_ip: first X-Forwarded-For entry, else REMOTE_ADDR. */
function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const f = Array.isArray(fwd) ? fwd.join(',') : fwd;
  if (f) return f.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? null;
}

const r = djangoRouter('api/lease-agreements/');

r.path('for-booking/<int:booking_id>/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const b = await bookingOr404(req.params.booking_id);
    const uid = (req as ApiRequest).user!.id;
    if (uid !== b.customer_id && uid !== b.owner_id) return res.status(404).json({ detail: 'Not found.' });
    const lease = await db.selectFrom('leaseagreements_leaseagreement').selectAll().where('booking_id', '=', b.id).orderBy('generated_at', 'desc').executeTakeFirst();
    if (!lease) return void res.status(204).end();
    return serializeLease(lease, req);
  },
}));

r.path('<int:booking_id>/accept/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const b = await bookingOr404(req.params.booking_id);
    const user = (req as ApiRequest).user!;
    if (user.id !== b.customer_id) return res.status(403).json({ detail: 'Only the guest can accept the lease.' });
    if (!isLongTerm(b)) return res.status(400).json({ detail: 'This reservation has no lease agreement.' });
    await recordAcceptance({ id: b.id }, user, clientIp(req));
    const lease = await db.selectFrom('leaseagreements_leaseagreement').selectAll().where('booking_id', '=', b.id).orderBy('generated_at', 'desc').executeTakeFirstOrThrow();
    return res.status(201).json(await serializeLease(lease, req));
  },
}));

export { CURRENT_LEASE_VERSION };
