// authapp.utils — verification / password-reset / MFA email-code helpers.

import { randomBytes, randomInt } from 'node:crypto';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { checkPassword, makePassword } from '../../lib/hashers.js';
import { logger } from '../../lib/logger.js';
import { DEFAULT_FROM_EMAIL, isConsoleBackend, sendMail } from '../../lib/mail.js';
import { redis } from '../../lib/redis.js';
import { renderToString, stripTags } from '../../lib/templates.js';
import type { User } from '../../lib/view.js';

const TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
export const PASSWORD_RESET_EXPIRY_HOURS = 1;
export const MFA_EMAIL_CODE_TTL_SECONDS = 600;
const mfaKey = (userId: number) => `mfa_email_code:${userId}`;

/** secrets.token_urlsafe(32) */
function secureToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);

/** Template context `user` with Django's User.get_full_name(). */
export function templateUser(u: User) {
  return { ...u, get_full_name: () => `${u.first_name} ${u.last_name}`.trim() };
}

export async function sendVerificationEmail(user: User): Promise<void> {
  const token = secureToken();
  await db.updateTable('users_user')
    .set({ email_verification_token: token, email_verification_token_expires_at: hoursFromNow(EMAIL_VERIFICATION_EXPIRY_HOURS) })
    .where('id', '=', user.id).execute();
  const verification_url = `https://${config.localDomain}/api/auth/verify-email/?token=${token}`;
  const html = renderToString('auth/verification_email.html', { user: templateUser(user), verification_url, site_name: config.siteName });
  if (config.debug || isConsoleBackend) logger.info({ username: user.username, expires_hours: EMAIL_VERIFICATION_EXPIRY_HOURS }, 'email verification token issued (console backend)');
  await sendMail('Verify your Email Address', stripTags(html), DEFAULT_FROM_EMAIL, [user.email], html);
}

export async function sendPasswordResetEmail(user: User): Promise<void> {
  const token = secureToken();
  await db.updateTable('users_user')
    .set({ password_reset_token: token, password_reset_token_expires_at: hoursFromNow(PASSWORD_RESET_EXPIRY_HOURS) })
    .where('id', '=', user.id).execute();
  const frontend = config.frontendOrigin || `https://${config.localDomain}`;
  const reset_url = `${frontend.replace(/\/+$/, '')}/reset-password?token=${token}`;
  const html = renderToString('auth/password_reset_email.html', { user: templateUser(user), reset_url, site_name: config.siteName });
  await sendMail('Reset your Password', stripTags(html), DEFAULT_FROM_EMAIL, [user.email], html);
}

/** Stored hashed in (Express's own) Redis for 10 minutes, single use. */
export async function sendMfaEmailCode(user: User): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await redis.set(mfaKey(user.id), await makePassword(code), 'EX', MFA_EMAIL_CODE_TTL_SECONDS);
  const html = renderToString('auth/mfa_email_code.html', {
    user: templateUser(user), code, site_name: config.siteName, expiry_minutes: MFA_EMAIL_CODE_TTL_SECONDS / 60,
  });
  await sendMail('Your verification code', stripTags(html), DEFAULT_FROM_EMAIL, [user.email], html);
}

export async function verifyMfaEmailCode(user: User, code: string): Promise<boolean> {
  const hashed = await redis.get(mfaKey(user.id));
  if (!hashed || !code || !(await checkPassword(code, hashed)).ok) return false;
  await redis.del(mfaKey(user.id));
  return true;
}
