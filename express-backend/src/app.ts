import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { ParseError } from './lib/errors.js';
import { adminUnavailable } from './middleware/admin.js';
import { errorHandler, notFound } from './middleware/errors.js';
import {
  allowedHosts, breakGlassAudit, cors, maintenance, requestLog, responseErrorLog, securityHeaders, suspension, viewTracking,
} from './middleware/core.js';
import { resolve } from './routes/registry.js';

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // Django's ConditionalGetMiddleware isn't enabled

  // settings.MIDDLEWARE order
  app.use(responseErrorLog); // django.request's log_response (errors.log), around everything
  app.use(cors, securityHeaders, allowedHosts, requestLog, suspension, maintenance, breakGlassAudit, viewTracking);

  // /admin/ (DJANGO_ADMIN_URL): Django's HTML admin isn't ported → 503 page.
  app.use(adminUnavailable);

  // DRF parsers: JSON + form here; multipart is parsed per view (lib/upload.ts).
  // DATA_UPLOAD_MAX_MEMORY_SIZE = 10 MB.
  //
  // JSON is parsed LAZILY, like DRF's request.data: the bytes are read here
  // (and kept as req.rawBody, e.g. for Stripe signature checks), but parsing
  // happens on first access to req.body. So authentication/permission errors
  // win over a malformed body, views that never read the body never fail on
  // it, and a parse error surfaces as DRF's ParseError at the point of access.
  // Top-level scalars/null are accepted (DRF's JSONParser isn't strict).
  const JSON_TYPES = ['application/json', 'application/*+json'];
  app.use(express.raw({ type: JSON_TYPES, limit: '10mb' }));
  app.use((req, _res, next) => {
    if (!Buffer.isBuffer(req.body) || !req.is(JSON_TYPES)) return next();
    const buf: Buffer = req.body;
    (req as unknown as { rawBody: Buffer }).rawBody = buf;
    let parsed: unknown;
    let done = false;
    Object.defineProperty(req, 'body', {
      configurable: true,
      enumerable: true,
      get() {
        if (!done) {
          // Empty body → empty data (DRF returns an empty QueryDict).
          if (buf.length === 0) parsed = {};
          else {
            try {
              parsed = JSON.parse(buf.toString('utf8'));
            } catch (e) {
              throw new ParseError(`JSON parse error - ${(e as Error).message}`);
            }
          }
          done = true;
        }
        return parsed;
      },
      set(v) { parsed = v; done = true; },
    });
    next();
  });
  app.use(express.urlencoded({
    extended: false, limit: '10mb',
    verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buf); },
  }));
  app.use(cookieParser());

  // In production nginx serves /media/ itself; once Express is live,
  // switch-backend.sh proxies /media/ here instead (Express's own media copy).
  app.use('/media', express.static(config.mediaRoot, { index: false, fallthrough: true }));

  const { registerUnportedStubs } = await import('./routes/index.js');
  registerUnportedStubs();
  app.use(resolve);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
