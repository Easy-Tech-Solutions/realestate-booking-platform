// leaseagreements.serializers.LeaseAgreementSerializer

import type { Request } from 'express';
import { db } from '../../db/index.js';
import { drf, isoformat } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import type { LeaseRow } from './agreements.js';

/** LeaseAgreementSerializer(lease, context={'request': req}) */
export async function serializeLease(lease: LeaseRow, req: Request | null) {
  const acc = await db.selectFrom('leaseagreements_leaseacceptance').select('accepted_at')
    .where('booking_id', '=', lease.booking_id).where('version', '=', lease.version).orderBy('accepted_at', 'desc').executeTakeFirst();
  return {
    id: lease.id, booking: lease.booking_id, version: lease.version,
    document_url: lease.document ? fileUrl(req, lease.document) : null,
    landlord_name: lease.landlord_name, tenant_name: lease.tenant_name, property_address: lease.property_address,
    rent_display: lease.rent_display,
    lease_start: lease.lease_start === null ? null : String(lease.lease_start).slice(0, 10),
    lease_end: lease.lease_end === null ? null : String(lease.lease_end).slice(0, 10),
    is_accepted: !!acc, accepted_at: acc ? isoformat(acc.accepted_at) : null, generated_at: drf(lease.generated_at),
  };
}

