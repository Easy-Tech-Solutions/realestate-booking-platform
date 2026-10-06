// messaging/violations.py — anti-bypass violation recording + escalation.

import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { nowPg } from '../../lib/datetime.js';
import {
  notifyAccountSuspended, notifyMessageViolationRecipient, notifyMessageViolationSender, type UserLike,
} from '../../domain/notifications.js';
import { createSuspension } from '../../domain/suspensions.js';

export const VIOLATION_SUSPENSION_THRESHOLD = 3;
export const SUSPENSION_BAN_THRESHOLD = 2;
export const AUTO_SUSPENSION_DURATION_DAYS = 7;
export const AUTO_SUSPENSION_REASON_PREFIX = '[auto:anti-bypass]';

/** record_violations_and_escalate(sender, recipient, conversation, codes) — never raises. */
export async function recordViolationsAndEscalate(sender: UserLike, recipient: UserLike | null, conversationId: number, codes: string[]) {
  if (!codes.length) return;
  try {
    await recordAndEscalate(sender, recipient, conversationId, codes);
  } catch (err) {
    logger.error({ err }, `Anti-bypass violation recording failed for sender=${sender.id}`);
  }
}

async function recordAndEscalate(sender: UserLike, recipient: UserLike | null, conversationId: number, codes: string[]) {
  for (const code of codes) {
    let vtype: string;
    let label = '';
    if (code.startsWith('restricted_phrase:')) { vtype = 'restricted_phrase'; label = code.slice(code.indexOf(':') + 1); }
    else if (code === 'phone_number') vtype = 'phone_number';
    else vtype = 'email';
    await db.insertInto('messaging_messageviolation').values({
      conversation_id: conversationId, sender_id: sender.id, recipient_id: recipient ? recipient.id : null,
      violation_type: vtype, matched_label: label, created_at: nowPg(),
    }).execute();
  }

  try {
    await notifyMessageViolationSender(sender);
    if (recipient) await notifyMessageViolationRecipient(recipient, sender);
  } catch (err) {
    logger.error({ err }, `Anti-bypass violation notifications failed for sender=${sender.id}`);
  }

  const { n } = await db.selectFrom('messaging_messageviolation').select((eb) => eb.fn.countAll<string>().as('n'))
    .where('sender_id', '=', sender.id).executeTakeFirstOrThrow();
  const total = Number(n);
  if (total % VIOLATION_SUSPENSION_THRESHOLD !== 0) return;

  const { p } = await db.selectFrom('suspensions_suspension').select((eb) => eb.fn.countAll<string>().as('p'))
    .where('user_id', '=', sender.id).where('reason', 'like', `${AUTO_SUSPENSION_REASON_PREFIX.replace(/[\\%_]/g, '\\$&')}%`)
    .executeTakeFirstOrThrow();
  const prior = Number(p);

  let suspension;
  if (prior >= SUSPENSION_BAN_THRESHOLD) {
    suspension = await createSuspension({
      user_id: sender.id, issued_by_id: null, suspension_type: 'permanent',
      reason: `${AUTO_SUSPENSION_REASON_PREFIX} Permanent ban — ${prior + 1} automatic `
        + 'suspensions for repeated attempts to share contact info or move off-platform.',
      ends_at: null, related_report_id: null,
    });
  } else {
    const ends = new Date(Date.now() + AUTO_SUSPENSION_DURATION_DAYS * 86_400_000).toISOString().replace('Z', '000+00:00');
    suspension = await createSuspension({
      user_id: sender.id, issued_by_id: null, suspension_type: 'temporary',
      reason: `${AUTO_SUSPENSION_REASON_PREFIX} ${total} detected attempts to share contact `
        + 'info or move off-platform.',
      ends_at: ends, related_report_id: null,
    });
  }
  try {
    await notifyAccountSuspended(suspension);
  } catch (err) {
    logger.error({ err }, `Auto-suspension notification failed for sender=${sender.id}`);
  }
}
