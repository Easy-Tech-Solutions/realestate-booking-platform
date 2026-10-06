// authapp — /api/auth/ (port of authapp/views.py + urls.py).

import type { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import {
  activeSuspension, authenticate, createUser, emailIexact, hasUsablePassword, serializeAuthUser,
} from '../../domain/users.js';
import { logActivity } from '../../lib/activity.js';
import { firstForwardedIp } from '../../lib/clientIp.js';
import { isoformat } from '../../lib/datetime.js';
import { makePassword, makeUnusablePassword } from '../../lib/hashers.js';
import { accessFromRefresh, assertNotBlacklisted, blacklist, decode, refreshForUser, TokenError } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { TimestampSigner } from '../../lib/signing.js';
import { renderToString } from '../../lib/templates.js';
import { anonRateThrottle } from '../../lib/throttle.js';
import { isValidEmail, truthy } from '../../lib/validators.js';
import { AllowAny, apiView, IsAuthenticated, type ApiRequest, type User } from '../../lib/view.js';
import { isFeatureEnabled } from '../../middleware/core.js';
import { djangoRouter } from '../../routes/registry.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './utils.js';

export const MFA_LOGIN_SALT = 'superadmin-mfa-login';

/**
 * request.data for these views, which call request.data.get(...): a JSON body
 * that isn't an object (list, number, null, ...) has no .get → AttributeError
 * → 500 in Django, so throw the same way. No body → empty data.
 */
const data = (req: Request): Record<string, unknown> => {
  const b: unknown = req.body;
  if (b === undefined) return {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new Error(`'${b === null ? 'NoneType' : Array.isArray(b) ? 'list' : typeof b}' object has no attribute 'get'`);
  return b as Record<string, unknown>;
};
const str = (v: unknown) => (v === undefined || v === null ? v : String(v)) as string | null | undefined;

function setRefreshCookie(res: Response, refresh: string) {
  const c = config.refreshCookie;
  res.cookie(c.name, refresh, {
    httpOnly: true, secure: c.secure, sameSite: c.sameSite.toLowerCase() as 'lax' | 'strict' | 'none',
    domain: c.domain, maxAge: c.maxAgeSeconds * 1000, path: c.path,
  });
}

function deleteRefreshCookie(res: Response) {
  // HttpResponse.delete_cookie: empty value, Max-Age=0, expired date; Secure only when SameSite=None.
  res.cookie(config.refreshCookie.name, '', {
    path: config.refreshCookie.path, domain: config.refreshCookie.domain, maxAge: 0, expires: new Date(0),
  });
}

function suspensionResponse(s: { reason: string; suspension_type: string; ends_at: string | null }) {
  return { error: 'Your account has been suspended.', code: 'account_suspended', reason: s.reason, suspension_type: s.suspension_type, ends_at: s.ends_at ? isoformat(s.ends_at) : null };
}

/** Returns true (and sends 403) if the request's device fingerprint is blocked. */
async function blockedFingerprint(req: Request, res: Response): Promise<boolean> {
  const fp = String(req.headers['x-device-fingerprint'] ?? '').trim();
  if (!fp) return false;
  const hit = await db.selectFrom('trustsafety_blockedfingerprint').select('id').where('fingerprint', '=', fp).executeTakeFirst();
  if (!hit) return false;
  res.status(403).json({ error: 'This device is not permitted to create or access an account.' });
  return true;
}

/** _unique_username_from_email */
async function uniqueUsername(email: string): Promise<string> {
  const base = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'user';
  let candidate = base;
  while (await db.selectFrom('users_user').select('id').where('username', '=', candidate).executeTakeFirst()) {
    candidate = `${base}-${randomBytes(3).toString('hex')}`;
  }
  return candidate;
}

async function issueTokens(res: Response, user: User, status = 200) {
  const { refresh, payload } = await refreshForUser(user.id);
  setRefreshCookie(res, refresh);
  res.status(status).json({ access: accessFromRefresh(payload), user: await serializeAuthUser(user) });
}

const r = djangoRouter('api/auth/');

// --- register -------------------------------------------------------------------
r.path('register/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('register')],
  async POST(req, res) {
    if (!(await isFeatureEnabled('new_registrations_enabled', true))) {
      return res.status(403).json({ error: 'New account registration is temporarily disabled. Please try again later.' });
    }
    if (await blockedFingerprint(req, res)) return;

    const d = data(req);
    const email = d.email as string | undefined;
    const password = d.password as string | undefined;
    const password2 = d.password2;
    const first_name = String(d.first_name || '').trim();
    const last_name = String(d.last_name || '').trim();
    const age_confirmed = d.age_confirmed;

    if (![password, email, password2, first_name, last_name].every(truthy)) {
      return res.status(400).json({ error: 'first_name, last_name, email, password, and password2 are required' });
    }
    // str(None) == 'None'; Python's str(True) == 'True'
    const age = age_confirmed === true ? 'true' : age_confirmed === false ? 'false' : String(age_confirmed ?? 'None');
    if (!['true', '1', 'yes', 'on'].includes(age.trim().toLowerCase())) {
      return res.status(400).json({ error: 'You must confirm you are at least 18 years old to register.' });
    }
    if (password !== password2) return res.status(400).json({ error: 'Passwords do not match' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid email' });
    if (password!.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters long' });

    const existing = await db.selectFrom('users_user').selectAll().where(emailIexact(email!)).orderBy('id').execute();
    if (existing.length) {
      const verifyRequired = config.requireEmailVerification;
      const pending = existing.filter((u) => verifyRequired && !u.email_verified && hasUsablePassword(u));
      const blocking = existing.filter((u) => !pending.includes(u));
      if (blocking.length || !pending.length) return res.status(400).json({ error: 'Email already exists' });

      const user = pending[pending.length - 1]!;
      const hashed = await makePassword(password!);
      await db.updateTable('users_user').set({ first_name, last_name, password: hashed, is_active: false }).where('id', '=', user.id).execute();
      Object.assign(user, { first_name, last_name, password: hashed, is_active: false });
      try {
        await sendVerificationEmail(user);
      } catch (e) {
        logger.error({ err: e, user_id: user.id }, 'register: failed to resend verification for pending account');
        return res.status(503).json({ error: "We couldn't send the verification email just now. Please try again in a moment." });
      }
      logActivity(req, 'user_registration_resent', { resource_type: 'user', resource_id: user.id });
      return res.status(200).json({ message: "This email is already registered but not yet verified. We've sent a fresh verification link — please check your inbox." });
    }

    const username = await uniqueUsername(email!);
    try {
      const user = await db.transaction().execute(async (trx) => {
        const u = await createUser({
          username, email: email!, password: await makePassword(password!), first_name, last_name,
          is_active: !config.requireEmailVerification,
        }, trx);
        if (config.requireEmailVerification) {
          // Runs inside the transaction in Django too: a send failure rolls the user back.
          await sendVerificationEmailTx(u, trx);
        }
        await trx.insertInto('trustsafety_accountsignupevent').values({ user_id: u.id, ip_address: firstForwardedIp(req) || null, created_at: new Date() }).execute();
        return u;
      });
      const message = config.requireEmailVerification
        ? 'User registered successfully. Please check your email to verify your account.'
        : 'User registered successfully. You can now log in.';
      logActivity(req, 'user_registered', { resource_type: 'user', resource_id: user.id });
      return res.status(201).json({ message });
    } catch (e) {
      logger.error({ err: e }, 'register: failed during user creation or email send');
      return res.status(503).json({ error: 'Registration could not be completed because the verification email could not be sent. Please try again in a moment.' });
    }
  },
}));

/** send_verification_email inside the register transaction (token saved on the uncommitted row). */
async function sendVerificationEmailTx(u: User, trx: Parameters<Parameters<ReturnType<typeof db.transaction>['execute']>[0]>[0]) {
  const { EMAIL_VERIFICATION_EXPIRY_HOURS } = await import('./utils.js');
  const token = randomBytes(32).toString('base64url');
  await trx.updateTable('users_user')
    .set({ email_verification_token: token, email_verification_token_expires_at: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 3600_000) })
    .where('id', '=', u.id).execute();
  const { sendMail, DEFAULT_FROM_EMAIL } = await import('../../lib/mail.js');
  const { stripTags } = await import('../../lib/templates.js');
  const { templateUser } = await import('./utils.js');
  const html = renderToString('auth/verification_email.html', {
    user: templateUser(u), verification_url: `https://${config.localDomain}/api/auth/verify-email/?token=${token}`, site_name: config.siteName,
  });
  await sendMail('Verify your Email Address', stripTags(html), DEFAULT_FROM_EMAIL, [u.email], html);
}

// --- verify-email ------------------------------------------------------------------
async function verifyEmail(req: ApiRequest, res: Response) {
  const token = req.method === 'POST' ? data(req).token : (req.query.token as string | undefined);
  if (!truthy(token)) return res.status(400).json({ error: 'Token is required' });
  const login_url = config.frontendOrigin || `https://${config.localDomain}`;
  const html = (name: string, ctx: Record<string, unknown>, status: number) =>
    res.status(status).type('text/html; charset=utf-8').send(renderToString(name, { login_url, site_name: config.siteName, ...ctx }));

  const user = await db.selectFrom('users_user').selectAll().where('email_verification_token', '=', String(token)).executeTakeFirst();
  if (!user) {
    if (req.method === 'GET') return html('auth/verification_failure.html', { heading: 'Invalid verification link', message: 'This verification link is invalid or has already been used.' }, 400);
    return res.status(400).json({ error: 'Invalid verification token' });
  }
  if (user.email_verification_token_expires_at && Date.now() > Date.parse(isoformat(user.email_verification_token_expires_at)!)) {
    if (req.method === 'GET') {
      return html('auth/verification_failure.html', {
        heading: 'Link expired',
        message: "This verification link has expired. Sign in with your email and password and we'll offer to send you a new link — or just sign up again with the same email to receive a fresh one.",
      }, 400);
    }
    return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
  }
  await db.updateTable('users_user')
    .set({ email_verified: true, is_active: true, email_verification_token: null, email_verification_token_expires_at: null })
    .where('id', '=', user.id).execute();
  if (req.method === 'GET') return html('auth/verification_success.html', {}, 200);
  return res.json({ message: 'Email verified successfully' });
}
r.path('verify-email/', apiView({ permissions: [AllowAny], throttles: [anonRateThrottle('verify_email')], GET: verifyEmail, POST: verifyEmail }));

// --- resend-verification -----------------------------------------------------------
r.path('resend-verification/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('resend_verification')],
  async POST(req, res) {
    const email = String(data(req).email || '').trim().toLowerCase();
    const generic = { message: "If an account with that email still needs verification, we've sent a new link. Please check your inbox." };
    if (!email || !config.requireEmailVerification) return res.json(generic);
    const users = await db.selectFrom('users_user').selectAll().where(emailIexact(email)).where('email_verified', '=', false).orderBy('id').execute();
    for (const u of users) {
      if (!hasUsablePassword(u)) continue;
      try { await sendVerificationEmail(u); } catch (e) { logger.error({ err: e, user_id: u.id }, 'resend_verification: failed to send'); }
    }
    return res.json(generic);
  },
}));

// --- login -------------------------------------------------------------------------
r.path('login/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('login')],
  async POST(req, res) {
    const d = data(req);
    const email = d.email; const password = d.password;
    if (!truthy(email) || !truthy(password)) return res.status(400).json({ error: 'email and password required' });
    if (await blockedFingerprint(req, res)) return;

    const candidates = await db.selectFrom('users_user').select(['id', 'username']).where(emailIexact(String(email))).execute();
    if (!candidates.length) return res.status(401).json({ error: 'invalid credentials' });

    let user: User | null = null;
    for (const c of candidates) {
      user = await authenticate(c.username, String(password));
      if (user) break;
    }
    if (!user) {
      logActivity(req, 'user_login_failed', { user_email: email });
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (config.requireEmailVerification && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in. Check your email for the verification link.', code: 'email_not_verified' });
    }
    if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });
    const s = await activeSuspension(user.id);
    if (s) return res.status(403).json(suspensionResponse(s));

    const mfa = await db.selectFrom('superadmin_mfadevice').select('id').where('user_id', '=', user.id).where('confirmed', '=', true).executeTakeFirst();
    if (mfa) return res.json({ mfa_required: true, mfa_token: new TimestampSigner(MFA_LOGIN_SALT).sign(String(user.id)) });

    logActivity(req, 'user_login', { user });
    await issueTokens(res, user);
  },
}));

// --- logout ------------------------------------------------------------------------
r.path('logout/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    logActivity(req, 'user_logout');
    const raw = req.cookies?.[config.refreshCookie.name] || data(req).refresh;
    if (truthy(raw)) {
      try {
        const payload = decode(String(raw), 'refresh');
        await assertNotBlacklisted(payload);
        await blacklist(String(raw), payload);
      } catch (e) {
        if (!(e instanceof TokenError)) return res.status(500).json({ error: String((e as Error).message) });
      }
    }
    deleteRefreshCookie(res);
    // Express strips 205 bodies; Django sends one — write it directly.
    const body = JSON.stringify({ message: 'Logged out successfully' });
    res.writeHead(205, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  },
}));

// --- refresh-token -----------------------------------------------------------------
r.path('refresh-token/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const raw = req.cookies?.[config.refreshCookie.name] || data(req).refresh;
    if (!truthy(raw)) return res.status(400).json({ error: 'Refresh token is required' });
    const invalid = () => { deleteRefreshCookie(res); return res.status(401).json({ error: 'Invalid or expired refresh token' }); };

    let old;
    try {
      old = decode(String(raw), 'refresh');
      await assertNotBlacklisted(old);
    } catch (e) {
      if (e instanceof TokenError) return invalid();
      throw e;
    }
    const user = old.user_id
      ? await db.selectFrom('users_user').selectAll().where('id', '=', Number(old.user_id)).executeTakeFirst()
      : undefined;
    if (!user || !user.is_active) return invalid();
    const s = await activeSuspension(user.id);
    if (s) return res.status(403).json(suspensionResponse(s));

    await blacklist(String(raw), old);
    const { refresh, payload } = await refreshForUser(user.id);
    const access = accessFromRefresh(payload);
    setRefreshCookie(res, refresh);
    return res.json({ access, access_token: access });
  },
}));

// --- me ------------------------------------------------------------------------------
r.path('me/', apiView({ permissions: [IsAuthenticated], GET: async (req) => serializeAuthUser(req.user!) }));

// --- password reset ------------------------------------------------------------------
r.path('password-reset/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('password_reset')],
  async POST(req, res) {
    const email = data(req).email;
    if (!truthy(email)) return res.status(400).json({ error: 'Email is required' });
    const msg = { message: 'If an account with that email exists, a password reset link has been sent.' };
    // email=email (exact match, unlike login)
    const users = await db.selectFrom('users_user').selectAll().where('email', '=', String(email)).orderBy('id').execute();
    for (const u of users) {
      try { await sendPasswordResetEmail(u); } catch (e) { logger.error({ err: e, user_id: u.id }, 'password_reset_request: failed to send reset email'); }
    }
    return res.json(msg);
  },
}));

r.path('password-reset-confirm/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('password_reset')],
  async POST(req, res) {
    const d = data(req);
    const { token, password, password2 } = d;
    if (![token, password, password2].every(truthy)) return res.status(400).json({ error: 'token, password, and password2 are required' });
    if (password !== password2) return res.status(400).json({ error: 'Passwords do not match' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    const user = await db.selectFrom('users_user').selectAll().where('password_reset_token', '=', String(token)).executeTakeFirst();
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });
    if (user.password_reset_token_expires_at && Date.now() > Date.parse(isoformat(user.password_reset_token_expires_at)!)) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    await db.updateTable('users_user')
      .set({ password: await makePassword(String(password)), password_reset_token: null, password_reset_token_expires_at: null })
      .where('id', '=', user.id).execute();
    return res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  },
}));

// --- google ---------------------------------------------------------------------------
const GOOGLE_ALLOWED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const googleClient = new OAuth2Client();

async function verifyGoogleIdToken(token: string): Promise<Record<string, unknown> | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  if (!clientId) { logger.error('google_login: GOOGLE_OAUTH_CLIENT_ID is not configured'); return null; }
  let payload: Record<string, unknown> | undefined;
  try {
    payload = (await googleClient.verifyIdToken({ idToken: token, audience: clientId })).getPayload() as Record<string, unknown> | undefined;
  } catch (e) {
    logger.warn({ err: String(e) }, 'google_login: token verification failed');
    return null;
  }
  if (!payload) return null;
  if (!GOOGLE_ALLOWED_ISSUERS.has(String(payload.iss))) return null;
  if (!payload.email || !payload.sub) return null;
  if (!payload.email_verified) return null;
  return payload;
}

r.path('google/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('google_login')],
  async POST(req, res) {
    if (await blockedFingerprint(req, res)) return;
    const idToken = data(req).id_token;
    if (!truthy(idToken)) return res.status(400).json({ error: 'id_token is required' });
    const payload = await verifyGoogleIdToken(String(idToken));
    if (!payload) return res.status(401).json({ error: 'Invalid Google token' });

    const sub = String(payload.sub);
    const email = String(payload.email).toLowerCase().trim();
    const first_name = String(payload.given_name || '');
    const last_name = String(payload.family_name || '');

    const social = await db.selectFrom('authapp_socialaccount').selectAll().where('provider', '=', 'google').where('provider_user_id', '=', sub).executeTakeFirst();
    if (social) {
      const user = await db.selectFrom('users_user').selectAll().where('id', '=', social.user_id).executeTakeFirstOrThrow();
      if (user.is_staff || user.is_superuser || user.role === 'admin') {
        return res.status(403).json({ error: 'Administrator accounts must sign in with a password.' });
      }
      if (!user.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });
      const s = await activeSuspension(user.id);
      if (s) return res.status(403).json(suspensionResponse(s));
      await db.updateTable('authapp_socialaccount').set({ last_login_at: new Date() }).where('id', '=', social.id).execute();
      return issueTokens(res, user, 200);
    }

    const conflict = { error: 'An account with this email already exists. Please log in with your password.', code: 'email_already_registered' };
    if (await db.selectFrom('users_user').select('id').where(emailIexact(email)).executeTakeFirst()) return res.status(409).json(conflict);
    if (!(await isFeatureEnabled('new_registrations_enabled', true))) {
      return res.status(403).json({ error: 'New account registration is temporarily disabled. Please try again later.' });
    }

    let user: User;
    try {
      const out = await db.transaction().execute(async (trx) => {
        if (await trx.selectFrom('users_user').select('id').where(emailIexact(email)).executeTakeFirst()) return null;
        const u = await createUser({
          username: await uniqueUsername(email), email, first_name, last_name, role: 'user',
          email_verified: true, is_active: true, password: makeUnusablePassword(),
        }, trx);
        await trx.insertInto('authapp_socialaccount').values({
          user_id: u.id, provider: 'google', provider_user_id: sub, email_at_link: email, last_login_at: new Date(), created_at: new Date(),
        }).execute();
        await trx.insertInto('trustsafety_accountsignupevent').values({ user_id: u.id, ip_address: firstForwardedIp(req) || null, created_at: new Date() }).execute();
        return u;
      });
      if (!out) return res.status(409).json(conflict);
      user = out;
    } catch {
      return res.status(503).json({ error: 'Could not complete Google sign-up. Please try again.' });
    }
    return issueTokens(res, user, 201);
  },
}));

void sql;
