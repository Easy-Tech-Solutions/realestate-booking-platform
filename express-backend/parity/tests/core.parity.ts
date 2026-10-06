import { describe, expect, it } from 'vitest';
import { Pair, same } from '../lib.js';

describe('core routing & errors', () => {
  const p = new Pair();
  it('health check', async () => same(await p.req('GET', '/api/health/')));
  it('APPEND_SLASH redirect', async () => same(await p.req('GET', '/api/health'), { headers: ['location'] }));
  it('unknown route 404', async () => same(await p.req('GET', '/api/nope/')));
  it('int converter mismatch 404', async () => same(await p.req('GET', '/api/listings/abc/')));
  it('malformed bearer header', async () => same(await p.req('GET', '/api/health/', { headers: { Authorization: 'Bearer a b' } })));
});

describe('lazy request parsing (DRF request.data semantics)', () => {
  const bad = { headers: { 'Content-Type': 'application/json' } };
  it('malformed JSON + no credentials → 401 first', async () => {
    const p = new Pair();
    const r = await p.req('POST', '/api/auth/logout/', { ...bad, raw: '{bad' });
    same(r, { headers: ['www-authenticate'] });
  });
  it('malformed JSON on an AllowAny view → 400 ParseError', async () => {
    const p = new Pair();
    const [d, e] = await Promise.all(['django', 'express'].map((s) =>
      (p as unknown as Record<string, { req: Pair['django']['req'] }>)[s]!.req('POST', '/api/auth/login/', { headers: { 'Content-Type': 'application/json' }, raw: '{bad' } as never)));
    expect(e!.status).toBe(d!.status);
    expect(d!.status).toBe(400);
    expect(Object.keys(e!.body as object)).toEqual(Object.keys(d!.body as object));
    expect(String((e!.body as { detail: string }).detail)).toMatch(/^JSON parse error - /);
  });
  it('top-level scalar JSON body is accepted by the parser', async () => same(await new Pair().req('POST', '/api/auth/login/', { json: 42 })));
});

// Django's HTML admin is deliberately NOT ported: Express answers everything
// under /admin/ (DJANGO_ADMIN_URL) with a 503 page that points staff to the
// superadmin portal. Django serves its real admin there, so the two sides
// differ BY DESIGN — these tests assert the Express side only.
describe('/admin/ on Express (not ported by decision; Express-only assertions)', () => {
  const c = new Pair().express;
  const csp = (r: { headers: Headers }) => r.headers.get('content-security-policy') ?? '';
  for (const [method, path] of [['GET', '/admin/'], ['GET', '/admin/login/?next=/admin/'], ['POST', '/admin/users/user/1/change/'], ['HEAD', '/admin/']] as const) {
    it(`${method} ${path} → 503 HTML page`, async () => {
      const r = await c.req(method, path);
      expect(r.status).toBe(503);
      expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
      if (method !== 'HEAD') {
        expect(r.text).toMatch(/^<!doctype html>/);
        expect(r.text).toContain('only available while the Django backend is live');
        expect(r.text).toMatch(/<a href="[^"]*\/management">/);
        expect(r.text).not.toMatch(/<script|<link|src=/); // self-contained
      }
      // Django-style security headers, with CSP_ADMIN (unsafe-eval) for the admin prefix.
      expect(csp(r)).toContain("script-src 'self' 'unsafe-eval' https://js.stripe.com;");
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('referrer-policy')).toBe('same-origin');
      expect(r.headers.get('strict-transport-security')).toMatch(/^max-age=\d+; includeSubDomains; preload$/);
    });
  }
  it('GET /admin (no slash) → APPEND_SLASH 301 to /admin/', async () => {
    const r = await c.req('GET', '/admin?x=1');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/admin/?x=1');
  });
  it('a non-admin page keeps the normal CSP', async () => {
    const r = await c.req('GET', '/api/health/');
    expect(csp(r)).toContain("script-src 'self' https://js.stripe.com;");
  });
});
