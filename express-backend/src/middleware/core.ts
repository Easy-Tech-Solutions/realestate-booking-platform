// Global request pipeline, mirroring settings.MIDDLEWARE in order:
//   CorsMiddleware → SecurityHeadersMiddleware → SecurityMiddleware (SSL redirect,
//   HSTS, nosniff, referrer/COOP) → CommonMiddleware (ALLOWED_HOSTS) →
//   RequestLogMiddleware → XFrameOptionsMiddleware → SuspensionMiddleware →
//   MaintenanceModeMiddleware → BreakGlassAuditMiddleware → ViewTrackingMiddleware

import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sql } from 'kysely';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { firstForwardedIp, remoteAddr } from '../lib/clientIp.js';
import { isoformat } from '../lib/datetime.js';
import { logger } from '../lib/logger.js';
import { pyStrRepr } from '../lib/py.js';
import { resolveUserQuietly } from '../lib/view.js';

const adminPrefix = '/' + config.adminUrl;

// --- django-cors-headers ---------------------------------------------------------

const CORS_ORIGINS = new Set(
  [
    'https://homekonet.vercel.app',
    'https://realestate-booking-platform.vercel.app',
    ...(config.debug ? ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'] : []),
    ...config.corsAllowedOrigins,
    config.frontendOrigin,
  ].filter(Boolean),
);
const CORS_ALLOW_HEADERS = 'accept, authorization, content-type, user-agent, x-csrftoken, x-requested-with, x-device-fingerprint';
const CORS_ALLOW_METHODS = 'DELETE, GET, OPTIONS, PATCH, POST, PUT';

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  res.vary('origin');
  if (!origin || !CORS_ORIGINS.has(origin)) return next();
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
    res.setHeader('access-control-allow-headers', CORS_ALLOW_HEADERS);
    res.setHeader('access-control-allow-methods', CORS_ALLOW_METHODS);
    res.setHeader('access-control-max-age', '86400');
    res.setHeader('content-length', '0');
    res.status(200).end();
    return;
  }
  next();
};

// --- SecurityHeadersMiddleware + SecurityMiddleware + XFrameOptionsMiddleware ---

const CSP =
  "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src 'self' https://js.stripe.com; " +
  "img-src 'self' data: https: blob:; connect-src 'self' https://api.stripe.com wss:; font-src 'self' data:; " +
  "style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const CSP_ADMIN = CSP.replace("script-src 'self' https://js.stripe.com;", "script-src 'self' 'unsafe-eval' https://js.stripe.com;");
const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(self), payment=(self "https://js.stripe.com"), usb=(), interest-cohort=()';
const HSTS_SECONDS = Number(process.env.SECURE_HSTS_SECONDS ?? '31536000');
const SSL_REDIRECT = !config.debug && !['0', 'false', 'no', 'off'].includes((process.env.SECURE_SSL_REDIRECT ?? 'true').toLowerCase());

function isSecure(req: Request): boolean {
  // SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
  return !config.debug && req.headers['x-forwarded-proto'] === 'https';
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  if (SSL_REDIRECT && !isSecure(req) && req.path !== '/api/health/') {
    res.status(301).location(`https://${req.headers.host ?? ''}${req.originalUrl}`).type('text/html; charset=utf-8').end();
    return;
  }
  const setDefault = (name: string, value: string) => {
    if (!res.getHeader(name)) res.setHeader(name, value);
  };
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: Parameters<Response['writeHead']>) {
    setDefault('Content-Security-Policy', req.path.startsWith(adminPrefix) ? CSP_ADMIN : CSP);
    setDefault('Permissions-Policy', PERMISSIONS_POLICY);
    if (!config.debug && isSecure(req)) {
      setDefault('Strict-Transport-Security', `max-age=${HSTS_SECONDS}; includeSubDomains; preload`);
    }
    setDefault('X-Content-Type-Options', 'nosniff');
    setDefault('Referrer-Policy', 'same-origin');
    setDefault('Cross-Origin-Opener-Policy', 'same-origin');
    setDefault('X-Frame-Options', 'DENY');
    return writeHead.apply(this, args);
  } as Response['writeHead'];
  next();
};

// --- CommonMiddleware: ALLOWED_HOSTS ---------------------------------------------

function hostAllowed(host: string): boolean {
  const name = host.replace(/:\d+$/, '').toLowerCase();
  const allowed = config.allowedHosts.length ? config.allowedHosts : config.debug ? ['localhost', '127.0.0.1', '[::1]'] : [];
  return allowed.some((p) => p === '*' || p === name || (p.startsWith('.') && (name.endsWith(p) || name === p.slice(1))));
}

export const allowedHosts: RequestHandler = (req, res, next) => {
  if (!hostAllowed(req.headers.host ?? '')) {
    res.status(400).type('text/html').send('\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Bad Request (400)</title>\n</head>\n<body>\n  <h1>Bad Request (400)</h1><p></p>\n</body>\n</html>\n');
    return;
  }
  next();
};

// --- django.request: BaseHandler.get_response → log_response for status >= 400 ---

const requestLogger = logger.child({ logger: 'django.request' });
// http.HTTPStatus phrases (Python 3.12) where Node's differ.
const PY_REASON: Record<number, string> = {
  413: 'Request Entity Too Large', 414: 'Request-URI Too Long', 416: 'Requested Range Not Satisfiable', 418: "I'm a Teapot",
};
export const reasonPhrase = (status: number) => PY_REASON[status] ?? STATUS_CODES[status] ?? 'Unknown Status Code';
/** repr(request) under daphne: <ASGIRequest: GET '/path?query'> */
export const requestRepr = (req: Request) => `<ASGIRequest: ${req.method} ${pyStrRepr(req.originalUrl)}>`;

/**
 * django.utils.log.log_response for a request whose response wasn't logged
 * yet (errorHandler logs 500s itself, with the exception): WARNING for 4xx,
 * ERROR for 5xx, "<reason>: <path>" with status_code / request extras.
 */
export function logResponse(req: Request, res: Response, err?: unknown) {
  if (res.locals.djangoRequestLogged) return;
  res.locals.djangoRequestLogged = true;
  const status = res.statusCode;
  const fields = { ...(err ? { err } : {}), status_code: status, request: requestRepr(req) };
  const msg = `${reasonPhrase(status)}: ${req.path}`;
  if (status >= 500) requestLogger.error(fields, msg);
  else requestLogger.warn(fields, msg);
}

/** Registered first, so responses from every later middleware/view are covered. */
export const responseErrorLog: RequestHandler = (req, res, next) => {
  res.on('finish', () => { if (res.statusCode >= 400) logResponse(req, res); });
  next();
};

// --- RequestLogMiddleware ---------------------------------------------------------

const applicationLog = logger.child({ logger: 'homekonet.application' });

export const requestLog: RequestHandler = (req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
    // Django's request.user here is session-auth only, so JWT users log as null.
    applicationLog.info(
      { method: req.method, path: req.path, status_code: res.statusCode, duration_ms: durationMs, user_id: null, ip: firstForwardedIp(req) },
      `${req.method} ${req.path} ${res.statusCode}`,
    );
  });
  next();
};

// --- SuspensionMiddleware -----------------------------------------------------------

export const suspension: RequestHandler = async (req, res, next) => {
  try {
    if (req.path.startsWith('/admin/')) return next();
    const user = await resolveUserQuietly(req);
    if (user && !user.is_staff && !user.is_superuser) {
      const s = await db
        .selectFrom('suspensions_suspension')
        .selectAll()
        .where('user_id', '=', user.id)
        .where('status', '=', 'active')
        .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<string>`now()`)]))
        .orderBy('started_at', 'desc') // Suspension.Meta.ordering = ['-started_at']
        .executeTakeFirst();
      if (s) {
        res.status(403).json({
          detail: 'Your account has been suspended.',
          code: 'account_suspended',
          reason: s.reason,
          suspension_type: s.suspension_type,
          started_at: isoformat(s.started_at),
          ends_at: s.ends_at ? isoformat(s.ends_at) : null,
        });
        return;
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};

// --- MaintenanceModeMiddleware ------------------------------------------------------

const ALWAYS_ALLOWED = ['/api/health/', '/admin/', '/api/superadmin/', '/api/platform-ops/'];

export async function isFeatureEnabled(key: string, fallback = false): Promise<boolean> {
  const flag = await db.selectFrom('platformops_featureflag').select('is_enabled').where('key', '=', key).executeTakeFirst();
  return flag ? flag.is_enabled : fallback;
}

export const maintenance: RequestHandler = async (req, res, next) => {
  try {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || ALWAYS_ALLOWED.some((p) => req.path.startsWith(p))) return next();
    if (!(await isFeatureEnabled('maintenance_mode'))) return next();
    const user = await resolveUserQuietly(req);
    if (user && (user.is_staff || user.is_superuser)) return next();
    res.status(503).json({ detail: 'The platform is in read-only maintenance mode. Please try again shortly.', code: 'maintenance_mode' });
  } catch (e) {
    next(e);
  }
};

// --- BreakGlassAuditMiddleware ------------------------------------------------------

export const breakGlassAudit: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    void (async () => {
      const user = await resolveUserQuietly(req);
      if (!user) return;
      const active = await db
        .selectFrom('rbac_breakglasssession')
        .select('id')
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<string>`now()`)
        .executeTakeFirst();
      if (!active) return;
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      await db
        .insertInto('superadmin_adminauditlog')
        .values({
          actor_id: user.id,
          action: 'break_glass.request',
          target_type: 'request',
          target_id: '',
          target_repr: `${req.method} ${req.path}`,
          reason: '',
          ip_address: firstForwardedIp(req) || null,
          user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
          metadata: JSON.stringify({ method: req.method, path: req.path, status_code: res.statusCode, duration_ms: durationMs }),
          created_at: new Date(),
        })
        .execute();
    })().catch((e) => logger.error({ err: e }, 'break-glass audit failed'));
  });
  next();
};

// --- ViewTrackingMiddleware ---------------------------------------------------------

const VIEW_EXCLUDED = ['/images/', '/stats/', '/reviews/', '/favorites/', '/analytics/'];

export const viewTracking: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    if (!req.path.startsWith('/api/listings/') || req.method !== 'GET') return;
    const parts = req.path.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 3 || !/^\d+$/.test(parts[2]!)) return;
    if (VIEW_EXCLUDED.some((x) => req.path.includes(x))) return;
    // Django: request.user is session-only here, so JWT users are recorded as null.
    // TRUSTED_PROXY_IPS is empty, so the stored IP is always REMOTE_ADDR.
    void db
      .insertInto('listings_propertyview')
      .values({
        listing_id: Number(parts[2]),
        user_id: null,
        ip_address: remoteAddr(req),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 255),
        timestamp: new Date(),
      })
      .execute()
      .catch(() => undefined); // `except Exception: pass`
  });
  next();
};
