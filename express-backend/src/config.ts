// Runtime configuration. Variable names are the Django backend's own (the
// .env is generated from backend/.env by scripts/express-init-env.sh), so a
// setting means the same thing in both backends.

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name: string): string[] {
  return env(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const secretKey = env('DJANGO_SECRET_KEY');
if (!secretKey) {
  throw new Error('DJANGO_SECRET_KEY is not set (needed to sign JWTs compatibly with the Django backend).');
}

const debug = bool('DJANGO_DEBUG', false);

export const config = {
  debug,
  port: Number(env('PORT', '8000')),
  // Same key as Django: SimpleJWT signs with SECRET_KEY, so tokens issued by
  // either backend stay valid after a switch.
  secretKey,
  adminUrl: env('DJANGO_ADMIN_URL', 'admin/'),
  allowedHosts: list('DJANGO_ALLOWED_HOSTS'),
  corsAllowedOrigins: list('CORS_ALLOWED_ORIGINS'),
  frontendOrigin: env('FRONTEND_ORIGIN'),
  siteName: env('SITE_NAME', 'Real Estate Booking Platform'),
  localDomain: env('LOCAL_DOMAIN', 'localhost:8000'),
  requireEmailVerification: bool('AUTH_REQUIRE_EMAIL_VERIFICATION', true),

  db: {
    host: env('POSTGRES_HOST', 'express-db'),
    port: Number(env('POSTGRES_PORT', '5432')),
    database: env('POSTGRES_DB', 'homekonet'),
    user: env('POSTGRES_USER', 'homekonet_express'),
    password: env('POSTGRES_PASSWORD'),
  },
  redisUrl: env('REDIS_URL', 'redis://express-redis:6379/0'),
  mediaRoot: env('MEDIA_ROOT', '/app/media'),
  mediaUrl: env('MEDIA_URL', '/media/'),

  jwt: {
    accessLifetimeSeconds: 15 * 60,
    refreshLifetimeSeconds: 14 * 24 * 60 * 60,
  },
  refreshCookie: {
    name: 'refresh_token',
    path: '/api/auth/',
    sameSite: env('AUTH_REFRESH_COOKIE_SAMESITE', 'Lax'),
    domain: env('AUTH_REFRESH_COOKIE_DOMAIN') || undefined,
    secure: !debug,
    maxAgeSeconds: 14 * 24 * 60 * 60,
  },

  // Background jobs only run when this backend is the live one
  // (scripts/switch-backend.sh flips it) so nothing ever runs twice.
  jobsEnabled: bool('EXPRESS_JOBS_ENABLED', false),
} as const;
