// agents.serializers.AgentApplicationSerializer (read side)

import type { Request } from 'express';
import { db } from '../../db/index.js';
import { drf } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import { STAGE_FOR_STATUS, STATUS_LABELS, type ApplicationRow } from './services.js';

export async function serializeApplication(a: ApplicationRow, req: Request | null) {
  const applicant = await db.selectFrom('users_user').select('email').where('id', '=', a.applicant_id).executeTakeFirstOrThrow();
  return {
    id: a.id, full_name: a.full_name, address: a.address, phone: a.phone, email: applicant.email,
    id_document_url: a.id_document ? fileUrl(req, a.id_document) : null,
    status: a.status, status_display: STATUS_LABELS[a.status] ?? a.status, current_stage: STAGE_FOR_STATUS[a.status] ?? null,
    declined_stage: a.declined_stage, decline_reason: a.decline_reason, can_reapply: a.status === 'declined',
    created_at: drf(a.created_at), updated_at: drf(a.updated_at),
  };
}
