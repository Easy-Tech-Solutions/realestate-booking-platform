import type { ErrorRequestHandler, RequestHandler } from 'express';
import { APIException, ParseError } from '../lib/errors.js';
import { logResponse } from './core.js';
import { hasRoute } from '../routes/registry.js';

/** DRF exception handler + Django's handler500 (realestate_backend.error_views). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  // body-parser JSON failures → DRF ParseError
  if (err?.type === 'entity.parse.failed') err = new ParseError(`JSON parse error - ${err.message}`);
  if (err instanceof APIException) {
    for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    res.status(err.status).json(err.body);
    return;
  }
  res.status(500);
  logResponse(req, res, err); // django.request ERROR "Internal Server Error: <path>" with the exception
  res.json({ error: 'Internal server error' });
};

/** Django CommonMiddleware APPEND_SLASH + handler404. */
export const notFound: RequestHandler = (req, res) => {
  if (!req.path.endsWith('/') && hasRoute(req.path + '/')) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const q = req.originalUrl.slice(req.path.length);
      // HttpResponsePermanentRedirect: empty body, text/html
      res.status(301).location(req.path + '/' + q).type('text/html; charset=utf-8').end();
      return;
    }
    // Django raises RuntimeError for non-GET with APPEND_SLASH → 500 in production.
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  res.status(404).json({ error: 'Not found' });
};
