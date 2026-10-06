// agents.ops — the Home Konet Operations system account.

import { db } from '../../db/index.js';
import { DEFAULT_FROM_EMAIL } from '../../lib/mail.js';
import { createUser } from '../../domain/users.js';
import type { Executor } from '../bookings/services.js';

export const OPS_USERNAME = 'homekonet_ops';

/** get_ops_account(): User.objects.get_or_create(username='homekonet_ops', defaults={...}) */
export async function getOpsAccount(ex: Executor = db) {
  const existing = await ex.selectFrom('users_user').selectAll().where('username', '=', OPS_USERNAME).executeTakeFirst();
  if (existing) return existing;
  const opsEmail = process.env.OPS_EMAIL || DEFAULT_FROM_EMAIL;
  // User(**defaults).save(): no password given → '' (Django's field default)
  return createUser({
    username: OPS_USERNAME, email: opsEmail, password: '', first_name: 'Home Konet', last_name: 'Operations', is_active: false, role: 'user',
  }, ex);
}
