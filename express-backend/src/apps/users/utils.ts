// users.utils (OTP generation + phone/MoMo change OTP delivery) and the
// pyotp / qrcode pieces users.mfa_views relies on.

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { DEFAULT_FROM_EMAIL, sendMail } from '../../lib/mail.js';

/** generate_otp(): 6 random digits */
export function generateOtp(length = 6): string {
  return Array.from({ length }, () => String(randomInt(10))).join('');
}

/** send_phone_change_email_otp — raises on failure (send_mail fail_silently=False). */
export async function sendPhoneChangeEmailOtp(user: { first_name: string; username: string; email: string }, otp: string, purposeLabel = 'Mobile Money number') {
  const site = config.siteName;
  const subject = `[${site}] Verify your ${purposeLabel} change`;
  const message =
    `Hi ${user.first_name || user.username},\n\n` +
    `We received a request to change the ${purposeLabel} on your account.\n\n` +
    `Your verification code is:  ${otp}\n\n` +
    'This code expires in 10 minutes.\n\n' +
    'If you did not request this change, please secure your account ' +
    'immediately by resetting your password.\n\n' +
    `— The ${site} Team`;
  await sendMail(subject, message, DEFAULT_FROM_EMAIL, [user.email]);
}

/** send_phone_change_sms_otp — development stub: prints to the console (no SMS gateway wired up). */
export function sendPhoneChangeSmsOtp(phoneNumber: string, otp: string, networkProvider: string, _purposeLabel = 'Mobile Money number') {
  const networkLabel = networkProvider === 'mtn' ? 'MTN Mobile Money' : 'Orange Money';
  logger.info(`\n=== PHONE CHANGE SMS OTP ===\nTo: ${phoneNumber}  (${networkLabel})\nOTP: ${otp}  (valid 10 minutes)\nSubmit at: POST /api/users/phone-change/verify-sms/\n${'='.repeat(35)}`);
}

// ---- pyotp -------------------------------------------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** pyotp.random_base32() */
export function randomBase32(length = 32): string {
  return Array.from({ length }, () => B32[randomInt(32)]).join('');
}

function base32Decode(secret: string): Buffer {
  const s = secret.toUpperCase().replace(/=+$/, '');
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Non-base32 digit found');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** pyotp.TOTP(secret).verify(code, valid_window=1) — NFKC-normalised constant-time compare. */
export function totpVerify(secret: string, code: string, validWindow = 1, now = Date.now()): boolean {
  const key = base32Decode(secret);
  const t = Math.floor(now / 1000 / 30);
  const given = Buffer.from(code.normalize('NFKC'));
  for (let i = -validWindow; i <= validWindow; i++) {
    const exp = Buffer.from(hotp(key, t + i).normalize('NFKC'));
    if (given.length === exp.length && timingSafeEqual(given, exp)) return true;
  }
  return false;
}

export function totpNow(secret: string, now = Date.now()): string {
  return hotp(base32Decode(secret), Math.floor(now / 1000 / 30));
}

/** urllib.parse.quote(s, safe) */
export function pyQuote(s: string, safe = '/'): string {
  let out = '';
  for (const b of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9_.~-]/.test(c) || (b < 0x80 && safe.includes(c))) out += c;
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** pyotp.TOTP(secret).provisioning_uri(name=..., issuer_name=...) */
export function provisioningUri(secret: string, name: string, issuer: string): string {
  const label = pyQuote(issuer) + ':' + pyQuote(name);
  const args = `secret=${pyQuote(secret, '')}&issuer=${pyQuote(issuer, '')}`; // urlencode(...).replace('+', '%20')
  return `otpauth://totp/${label}?${args}`;
}

// ---- qrcode.make(...) -----------------------------------------------------------------------

const ALPHA_NUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function* optimalSplit(data: string, pattern: RegExp): Generator<[boolean, string]> {
  while (data) {
    const m = pattern.exec(data);
    if (!m) break;
    if (m.index) yield [false, data.slice(0, m.index)];
    yield [true, m[0]];
    data = data.slice(m.index + m[0].length);
  }
  if (data) yield [false, data];
}

/** qrcode.util.optimal_data_chunks(data, minimum=20) → node-qrcode segments with the same modes. */
export function qrSegments(data: string, minimum = 20): { data: string; mode: 'numeric' | 'alphanumeric' | 'byte' }[] {
  const ascii = Buffer.from(data, 'utf8').toString('latin1');
  const short = ascii.length <= minimum;
  const num = new RegExp(short ? '^\\d+$' : `\\d{${minimum},}`);
  const alpha = new RegExp(short ? `^[${escapeRe(ALPHA_NUM)}]+$` : `[${escapeRe(ALPHA_NUM)}]{${minimum},}`);
  const out: { data: string; mode: 'numeric' | 'alphanumeric' | 'byte' }[] = [];
  for (const [isNum, chunk] of optimalSplit(ascii, num)) {
    if (isNum) { out.push({ data: chunk, mode: 'numeric' }); continue; }
    for (const [isAlpha, sub] of optimalSplit(chunk, alpha)) {
      out.push(isAlpha ? { data: sub, mode: 'alphanumeric' } : { data: Buffer.from(sub, 'latin1').toString('utf8'), mode: 'byte' });
    }
  }
  return out;
}

// python-qrcode's QRCode.best_mask_pattern(): lost_point() is scored on a test
// matrix whose format/version-info modules (and the dark module) are all light.
type Grid = boolean[][];

function lostLevel1(m: Grid, n: number): number {
  const container = new Array(n + 1).fill(0);
  for (let r = 0; r < n; r++) {
    let prev = m[r]![0]; let len = 0;
    for (let c = 0; c < n; c++) {
      if (m[r]![c] === prev) len++;
      else { if (len >= 5) container[len]++; len = 1; prev = m[r]![c]; }
    }
    if (len >= 5) container[len]++;
  }
  for (let c = 0; c < n; c++) {
    let prev = m[0]![c]; let len = 0;
    for (let r = 0; r < n; r++) {
      if (m[r]![c] === prev) len++;
      else { if (len >= 5) container[len]++; len = 1; prev = m[r]![c]; }
    }
    if (len >= 5) container[len]++;
  }
  let lost = 0;
  for (let l = 5; l <= n; l++) lost += container[l] * (l - 2);
  return lost;
}

function lostLevel2(m: Grid, n: number): number {
  let lost = 0;
  for (let r = 0; r < n - 1; r++) {
    const row = m[r]!; const next = m[r + 1]!;
    for (let c = 0; c < n - 1; c++) {
      const tr = row[c + 1];
      if (tr !== next[c + 1]) { c++; continue; }
      if (tr !== row[c]) continue;
      if (tr !== next[c]) continue;
      lost += 3;
    }
  }
  return lost;
}

function lostLevel3(m: Grid, n: number): number {
  let lost = 0;
  const at = (r: number, c: number) => m[r]![c]!;
  const check = (g: (k: number) => boolean) =>
    !g(1) && g(4) && !g(5) && g(6) && !g(9) &&
    ((g(0) && g(2) && g(3) && !g(7) && !g(8) && !g(10)) || (!g(0) && !g(2) && !g(3) && g(7) && g(8) && g(10)));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n - 10; c++) {
      if (check((k) => at(r, c + k))) lost += 40;
      if (at(r, c + 10)) c++;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n - 10; r++) {
      if (check((k) => at(r + k, c))) lost += 40;
      if (at(r + 10, c)) r++;
    }
  }
  return lost;
}

function lostLevel4(m: Grid, n: number): number {
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const percent = dark / (n * n);
  return Math.trunc(Math.abs(percent * 100 - 50) / 5) * 10;
}

function testMatrix(q: { modules: { size: number; get(r: number, c: number): number }; version: number }): Grid {
  const n = q.modules.size;
  const m: Grid = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => !!q.modules.get(r, c)));
  for (let i = 0; i < 15; i++) {
    if (i < 6) m[i]![8] = false; else if (i < 8) m[i + 1]![8] = false; else m[n - 15 + i]![8] = false;
    if (i < 8) m[8]![n - i - 1] = false; else if (i < 9) m[8]![15 - i] = false; else m[8]![15 - i - 1] = false;
  }
  m[n - 8]![8] = false;
  if (q.version >= 7) {
    for (let i = 0; i < 18; i++) {
      m[Math.floor(i / 3)]![(i % 3) + n - 8 - 3] = false;
      m[(i % 3) + n - 8 - 3]![Math.floor(i / 3)] = false;
    }
  }
  return m;
}

function bestMaskPattern(segments: unknown): number {
  let best = 0; let min = 0;
  for (let i = 0; i < 8; i++) {
    const q = QRCode.create(segments as never, { errorCorrectionLevel: 'M', maskPattern: i as never }) as never;
    const m = testMatrix(q);
    const n = m.length;
    const lost = lostLevel1(m, n) + lostLevel2(m, n) + lostLevel3(m, n) + lostLevel4(m, n);
    if (i === 0 || min > lost) { min = lost; best = i; }
  }
  return best;
}

/** base64 PNG of qrcode.make(data) (ERROR_CORRECT_M, box_size 10, border 4, python-qrcode's mask choice). */
export async function qrPngBase64(data: string): Promise<string> {
  const segments = qrSegments(data);
  const buf = await QRCode.toBuffer(segments as never, {
    errorCorrectionLevel: 'M', margin: 4, scale: 10, type: 'png', maskPattern: bestMaskPattern(segments) as never,
  });
  return buf.toString('base64');
}

/** The module matrix qrPngBase64 renders (for parity checks). */
export function qrMatrix(data: string): number[][] {
  const segments = qrSegments(data);
  const q = QRCode.create(segments as never, { errorCorrectionLevel: 'M', maskPattern: bestMaskPattern(segments) as never });
  const n = q.modules.size;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (q.modules.get(r, c) ? 1 : 0)));
}
