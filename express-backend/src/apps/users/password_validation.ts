// django.contrib.auth.password_validation.validate_password with the four
// AUTH_PASSWORD_VALIDATORS from settings.py, in the same order. Returns the
// list of messages (ValidationError.messages) — empty when valid.

import { gunzipSync } from 'node:zlib';
import { COMMON_PASSWORDS_GZ_B64 } from './common_passwords.js';

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
  common ??= new Set(gunzipSync(Buffer.from(COMMON_PASSWORDS_GZ_B64, 'base64')).toString('utf8').split('\n').map((x) => x.trim()));
  return common;
}

const chars = (s: string) => [...s];

/** difflib.SequenceMatcher(a, b).quick_ratio() */
function quickRatio(a: string, b: string): number {
  const ca = chars(a); const cb = chars(b);
  const full = new Map<string, number>();
  for (const c of cb) full.set(c, (full.get(c) ?? 0) + 1);
  const avail = new Map<string, number>();
  let matches = 0;
  for (const c of ca) {
    const n = avail.has(c) ? avail.get(c)! : (full.get(c) ?? 0);
    avail.set(c, n - 1);
    if (n > 0) matches++;
  }
  const len = ca.length + cb.length;
  return len ? (2 * matches) / len : 1;
}

const VERBOSE: Record<string, string> = { username: 'username', first_name: 'first name', last_name: 'last name', email: 'email address' };

export interface PwUser { username: string; first_name: string; last_name: string; email: string }

export function validatePassword(password: string, user: PwUser | null = null): string[] {
  const errors: string[] = [];
  // UserAttributeSimilarityValidator
  if (user) {
    const pw = password.toLowerCase();
    outer: for (const attr of ['username', 'first_name', 'last_name', 'email'] as const) {
      const value = user[attr];
      if (!value || typeof value !== 'string') continue;
      const lower = value.toLowerCase();
      const parts = [...lower.split(/[^\p{L}\p{N}_]+/u), lower];
      for (const part of parts) {
        const pwLen = chars(pw).length; const vLen = chars(part).length;
        if (pwLen >= 10 * vLen && vLen < (0.7 / 2) * pwLen) continue;
        if (quickRatio(pw, part) >= 0.7) {
          errors.push(`The password is too similar to the ${VERBOSE[attr]}.`);
          break outer;
        }
      }
    }
  }
  // MinimumLengthValidator
  if (chars(password).length < 8) errors.push('This password is too short. It must contain at least 8 characters.');
  // CommonPasswordValidator
  if (commonPasswords().has(password.toLowerCase().trim())) errors.push('This password is too common.');
  // NumericPasswordValidator (str.isdigit)
  if (/^\p{Nd}+$/u.test(password)) errors.push('This password is entirely numeric.');
  return errors;
}
