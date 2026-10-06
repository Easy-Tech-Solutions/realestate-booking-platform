// Django-style URL resolution. Routes are registered with Django's own
// pattern syntax ("api/listings/<int:pk>/") and resolved first-match-wins in
// registration order, like django.urls — so converter mismatches (e.g. a
// non-numeric <int:pk>) fall through to the same 404, and coverage against
// Django's route list (parity/django-routes.json) is a plain string compare.

import type { RequestHandler } from 'express';

interface Entry {
  pattern: string;
  regex: RegExp;
  handler: RequestHandler;
}
const entries: Entry[] = [];

const CONVERTERS: Record<string, string> = {
  int: '[0-9]+',
  str: '[^/]+',
  slug: '[-a-zA-Z0-9_]+',
  uuid: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  path: '.+',
  // DRF format_suffix_patterns: "<drf_format_suffix:format>" matches ".json" etc.
  drf_format_suffix: '\\.[a-z0-9]+',
};

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Django path() pattern → anchored RegExp with named groups. */
function pathToRegex(pattern: string): RegExp {
  let out = '';
  let last = 0;
  for (const m of pattern.matchAll(/<(?:(\w+):)?(\w+)>/g)) {
    out += escape(pattern.slice(last, m.index));
    out += `(?<${m[2]}>${CONVERTERS[m[1] ?? 'str'] ?? CONVERTERS.str})`;
    last = m.index! + m[0].length;
  }
  out += escape(pattern.slice(last));
  return new RegExp(`^/${out}$`);
}

export function hasRoute(path: string): boolean {
  return entries.some((e) => e.regex.test(path));
}

export function registeredPatterns(): string[] {
  return entries.map((e) => e.pattern);
}

/** Mirrors include('<app>.urls') at `prefix` (e.g. "api/listings/"). */
export function djangoRouter(prefix: string) {
  return {
    /** path('<sub>', view) */
    path(sub: string, handler: RequestHandler) {
      const pattern = prefix + sub;
      entries.push({ pattern, regex: pathToRegex(pattern), handler });
    },
    /**
     * re_path / DRF router pattern, written exactly as Django prints it
     * (e.g. "^(?P<pk>[^/.]+)/unread/$"). Python named groups are translated.
     */
    rePath(djangoRegex: string, handler: RequestHandler) {
      const pattern = prefix + djangoRegex;
      const body = djangoRegex.replace(/^\^/, '').replace(/\$$/, '').replace(/\(\?P</g, '(?<');
      entries.push({ pattern, regex: new RegExp(`^/${escape(prefix)}${body}$`), handler });
    },
  };
}

/** Top-level resolver: first matching pattern wins; captured groups become req.params. */
export const resolve: RequestHandler = (req, res, next) => {
  for (const e of entries) {
    const m = e.regex.exec(req.path);
    if (!m) continue;
    Object.defineProperty(req, 'params', { value: { ...(m.groups ?? {}) }, writable: true, configurable: true });
    return e.handler(req, res, next);
  }
  next();
};
