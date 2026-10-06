// Route table, in the same order as realestate_backend/urls.py. Each app's
// module registers its patterns via djangoRouter(); anything Django serves
// that hasn't been ported yet answers 501 (see registerUnportedStubs) so gaps
// are visible instead of looking like a 404.

import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { djangoRouter, registeredPatterns } from './registry.js';

const root = djangoRouter('');

// path('api/health/', health_check) — a plain Django view: any method, no auth.
root.path('api/health/', async (_req, res, next) => {
  try {
    await sql`SELECT 1`.execute(db);
    res.json({ status: 'ok' });
  } catch (e) {
    next(e);
  }
});

// App modules, in urls.py order (each registers its own patterns on import).
await (await import('../lib/apps.js')).loadAppModules('urls');

export function registerUnportedStubs(routesFile = new URL('../../parity/django-routes.json', import.meta.url)): number {
  const django: { pattern: string }[] = JSON.parse(readFileSync(routesFile, 'utf8'));
  const have = new Set(registeredPatterns());
  let n = 0;
  for (const { pattern } of django) {
    if (!pattern.startsWith('api/') || have.has(pattern)) continue;
    const stub = djangoRouter('');
    const handler = (_req: unknown, res: { status(n: number): { json(b: unknown): void } }) =>
      res.status(501).json({ detail: 'Not implemented in the Express backend yet.', code: 'express_not_implemented' });
    const caret = pattern.indexOf('^');
    if (caret >= 0) djangoRouter(pattern.slice(0, caret)).rePath(pattern.slice(caret), handler as never);
    else stub.path(pattern, handler as never);
    n++;
  }
  return n;
}
