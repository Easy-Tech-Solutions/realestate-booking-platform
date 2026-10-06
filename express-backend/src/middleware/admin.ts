// Django's HTML admin (path(settings.ADMIN_URL, admin.site.urls)) is NOT
// ported, by decision. Every request under '/' + DJANGO_ADMIN_URL gets a 503
// with a small self-contained page pointing staff at the superadmin portal in
// the frontend. Registered after the global middleware, so the response still
// carries the Django-style security headers (CSP_ADMIN for this prefix).

import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { escapeHtml } from '../lib/templates.js';

const adminPrefix = '/' + config.adminUrl.replace(/^\/+/, '');
const adminNoSlash = adminPrefix.replace(/\/+$/, '');

function portalUrl(): string {
  return (config.frontendOrigin || '').replace(/\/+$/, '') + '/management';
}

export function adminUnavailablePage(): string {
  const portal = escapeHtml(portalUrl());
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin unavailable</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f7f9; color: #1f2933; }
    main { max-width: 34rem; margin: 12vh auto 0; padding: 2rem; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    h1 { font-size: 1.35rem; margin: 0 0 1rem; }
    p { line-height: 1.5; }
    a { color: #0b5cad; }
  </style>
</head>
<body>
  <main>
    <h1>Django admin is not available</h1>
    <p>The Django admin site is only available while the Django backend is live.
       This server is currently running the Express backend.</p>
    <p>Staff can manage the platform from the superadmin portal:
       <a href="${portal}">${portal}</a></p>
  </main>
</body>
</html>
`;
}

export const adminUnavailable: RequestHandler = (req, res, next) => {
  if (req.path === adminNoSlash && adminNoSlash !== '' && (req.method === 'GET' || req.method === 'HEAD')) {
    // CommonMiddleware APPEND_SLASH → /admin/
    res.status(301).location(adminPrefix + req.originalUrl.slice(req.path.length)).type('text/html; charset=utf-8').end();
    return;
  }
  if (!(req.path.startsWith(adminPrefix) || req.path === adminNoSlash)) return next();
  res.status(503).type('text/html; charset=utf-8').send(adminUnavailablePage());
};
