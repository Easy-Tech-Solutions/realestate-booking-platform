# Porting guide — Django app → Express

**Status: complete.** Every Django API route is ported and covered by the parity
suite; the TEMP `_deps/` duplicates from the parallel porting waves have been
consolidated into `src/domain/*.ts` and shared helpers into `src/lib/`. This
guide stays the reference for changing or extending the port. Read it before
touching an app. The goal is **behavioural
identity**: the React frontend (and any API client) must not be able to tell
which backend answered. The parity suite is the judge.

## The contract

For every endpoint Django serves, Express must produce the same:
- status code, and JSON body (same keys, same value formats — DRF renders
  decimals as strings, datetimes via `drf()` in `lib/datetime.ts`, FK fields
  as the pk, file fields via `fileUrl()` (absolute when the serializer had
  `request` in context, relative otherwise));
- error bodies (DRF exceptions in `lib/errors.ts`; views that return
  `Response({"error": ...}, status=...)` must return exactly that);
- permission/authentication/throttle behaviour (`apiView({...})` in
  `lib/view.ts` reproduces DRF's order — set `permissions` and `throttles`
  exactly like the Django view; `throttles` default is `[userRateThrottle()]`,
  i.e. DRF's default `UserRateThrottle`);
- side effects: the same rows inserted/updated (columns Django fills
  automatically — `auto_now`, `auto_now_add`, defaults, `save()` overrides,
  signals — must be filled explicitly; Django creates no DB defaults),
  notifications, audit-log rows, emails (`lib/mail.ts` + `lib/templates.ts`),
  background tasks (`delay('<celery.dotted.name>', args)` from `lib/jobs.ts`).

Read the Django code **fully** (views, serializers, models incl. `save()` and
`Meta.ordering`, signals, permissions, throttles, services, tasks) before
writing the port. Default `Meta.ordering` applies to every unordered queryset
— reproduce it with `orderBy`.

## Where things go

```
src/apps/<django_app>/urls.ts     routes: r = djangoRouter('api/<prefix>/'); r.path('<int:pk>/', apiView({...}))
src/apps/<django_app>/tasks.ts    Celery tasks: defineTask('<app>.tasks.<name>', fn); schedule(...) for beat entries
src/apps/<django_app>/ws.ts       WebSocket consumers: wsRoute('^ws/.../$', consumer)
src/apps/<django_app>/*.ts        serializers, services, permissions — mirror the Django module names
src/domain/<django_app>.ts        functions OTHER apps call (e.g. domain/notifications.ts for notifications.services)
parity/tests/<django_app>.parity.ts
```

Register patterns **exactly as Django prints them** in
`parity/django-routes.json` (`path('<int:pk>/')`, or `rePath('^...$')` for
DRF-router regex routes). Coverage is checked by string comparison. DRF
ViewSets/routers produce several patterns (incl. `.<format>` suffix variants)
— register all of them.

Use the shared libraries; don't re-implement them:

| module | what |
|---|---|
| `lib/view.ts` | `apiView({...})` (DRF APIView dispatch order), permissions, `User`; `negotiatedView()` / `negotiate: true` = DRF content negotiation (`?format=`, `.<format>` suffix kwarg → 404, unsatisfiable `Accept` → 406) — used by bookings, leaseagreements, agents, payments, notifications |
| `lib/errors.ts` | DRF exceptions (`ValidationError`, `NotFound`, `NotAcceptable`, ...) |
| `lib/drf.ts` | `paginate()` (PageNumberPagination: `page`/`page_size` parsed with Python `int()` like DRF's `_positive_int`), `qp()` (= `query_params.get`), absolute URIs, `fileUrl()` |
| `lib/fields.ts` | DRF serializer-field validation engine (`validate(data, FieldSpec[], {partial, instanceId, html})`: char/slug/email/bool/int/choice/date/json/file, UniqueValidator, `validate_<field>` hooks, DRF 3.18 messages) and `parseDate` (Django `parse_date`, incl. ISO week dates). `required` defaults to **true** like DRF |
| `lib/py.ts` | Python built-ins: `pyStrip` (exact `str.isspace` set), `pyIntStr` (`int(str)`, Unicode digits, `_`), `pyIntPk`, `inBigintRange`, `pyTruthy`, `pyTypeName`, `pyStr`/`pyRepr`/`pyStrRepr`/`pyFloatRepr`, `pyJsonDumps`/`pyJsonLoads`/`PyNum` |
| `lib/upload.ts` | multipart parsing; `saveUpload(uploadTo, name, data, maxLength = 100)` = `FieldFile.save` on FileSystemStorage (Unicode `get_valid_filename`, Django 5 `get_available_name`: suffix before *all* extensions, root truncated to the FileField's `max_length`); `UploadedFile`/`isFile` |
| `lib/jobs.ts` | `defineTask`, `schedule`, `delay(name, args, {countdownSeconds, queue, jobId})` → job id; tasks not defined in this process route by a static task→queue map (AI tasks → `ai_scoring`) |
| `lib/mail.ts` | `sendMail(subject, text, from, to, html?, {attachments})` |
| `lib/logger.ts` | pino on stdout **and** Django's log files under `$LOG_DIR` (see README) — name loggers with `logger.child({ logger: '<python name>' })` |
| `lib/activity.ts` | `logActivity` / `logTransaction` (`app_logging.log_activity` / `log_transaction`) |
| `lib/templates.ts`, `lib/datetime.ts`, `lib/signing.ts`, `lib/hashers.ts`, `lib/jwt.ts` (SimpleJWT incl. `iat`, `accessForUser(id, extraClaims)`), `lib/throttle.ts`, `lib/validators.ts`, `lib/ws.ts` | as named |
| `middleware/core.ts` | `isFeatureEnabled`, Django middleware equivalents; `middleware/admin.ts` answers `/admin/` with 503 (Django admin not ported, by decision) |
| `domain/*.ts` | model behaviour other apps call (users, bookings, listings, payments, agents, propertyverifications, notifications, ...) |

Tables are typed in `src/db/schema.ts` (Kysely); query with `db` from `src/db/index.js`.

App-local helpers that intentionally stay per app (different API shapes or
deliberately different Python constructs — see each file's header):
the serializer engines in `listings/drf.ts` (`runSerializer`), `messaging/drf.ts`,
`bookings/drf.ts` (`runFields`), `payments/fields.ts` and `suspensions/serializers.ts`;
the request-data parsers (`users/request.ts`, `messaging/request.ts`,
`listings/drf.ts parseRequest`, `bookings/drf.ts requestData`, `payments/drf.ts`);
the Decimal implementations (`payments/decimal.ts` PyDecimal with a 28-digit
context, `notifications/decimal.ts` Dec for money arithmetic without context
rounding, and the parsers in `bookings/py.ts`/`listings/drf.ts`/`messaging/pyutil.ts`).

## Rules for parallel work (historical — the porting waves)

- **Only write inside the apps you own**: `src/apps/<your apps>/`,
  `src/domain/<your apps>.ts`, `parity/tests/<your apps>*.parity.ts`.
  Don't edit `src/lib/`, `src/routes/`, `src/app.ts`, `src/server.ts`,
  `src/worker.ts`, `package.json`, or another group's files. If a shared
  library needs a change, put a workaround in your own files and list the
  requested change in your final report.
- **Code from an app another group owns**: import it from
  `src/domain/<app>.ts` if that exists. Otherwise port the minimal piece you
  need into `src/apps/<your app>/_deps/<other_app>.ts`, headed
  `// TEMP duplicate of <django module.function> — consolidate when <app> is ported.`
- **Don't run `npm install`** (shared `node_modules`). Needed packages are
  pre-installed; request others in your report.
- **Never touch production**: no commands against the `backend`, `db`,
  `redis`, `frontend`, `celery*` or `express-*` containers, no
  `scripts/switch-backend.sh` / `express-sync-data.sh`, no `docker compose`
  without `-p homekonet-parity-<you>`. No git commits.

## Build and test (use your own name everywhere)

```bash
cd /opt/homekonet/express-backend
./dev.sh node_modules/.bin/tsc -p tsconfig.json --outDir dist-<name>      # emits even if other groups' files have type errors
./dev.sh node_modules/.bin/tsc -p tsconfig.json --noEmit | grep 'src/apps/<yours>'   # your type errors only
PARITY_NAME=<name> DIST=dist-<name> EXPRESS_APPS=<app1>,<app2> bash parity/run.sh tests/<app>
docker compose -p homekonet-parity-<name> -f parity/docker-compose.parity.yml logs parity-express   # Express errors
docker compose -p homekonet-parity-<name> -f parity/docker-compose.parity.yml logs parity-django    # Django errors
```

`parity/lib.ts`: `Pair` (send to both; `p.login(email)` logs both in),
`same(r)` (status + JSON), `sameRows(table, where, {ignore})` (DB state),
`sameCookie`, `accounts()` (one test account per role: user, agent, customer,
admin, superadmin — password `PASSWORD`), `dbs.django/express` (pg pools on the
two copies, for setup queries or reading tokens), `flushRedis()`.

Each `run.sh` resets both databases to the same snapshot, so tests may create
data freely. When a test needs fixture data, create it **identically in both
copies** through `dbs.django.query(...)` + `dbs.express.query(...)` (or via an
API call on both sides). Cover for every endpoint: anonymous / wrong-role /
right-role access, validation errors, success, DB rows written, and pagination
or filtering parameters the Django view supports.

Things that legitimately differ and are already normalised by the harness:
timestamps created "now" (±10 s), JWT strings. Anything else that differs is a
bug in the port — fix it, don't loosen the comparison. If a Django behaviour
looks like a bug, **reproduce it anyway** and note it in your report.

## Done means

Every Django route of your apps is registered (none left answering 501),
tasks/WS consumers ported, parity tests pass, and your report lists: routes
ported, tests written/passing, side effects not yet covered by tests,
anything you couldn't make identical and why, requested shared-lib changes.

## Shared services — use these, don't duplicate

- `src/domain/rbac.ts` — `hasPermission(user, resource, action)`, `hasAnyPermission`,
  `isFullAdmin` (sync), `hasRole`, `userRoles`, preset roles, and the dual-auth engine
  (`registerExecutor(actionKey, fn)`, `submitOrExecute`, `approve`, `reject`). If your
  app's Django code registers a dual-auth executor (e.g. `payment.refund`,
  `user.suspend`, `user.hard_delete`, `stripe_refund`), register it here with
  `registerExecutor` from your app module.
- `src/domain/superadmin.ts` — `IsSuperadminStaff` (Permission), `requireDepartment`,
  `userDepartments`, `isSuperadminStaff`, `getClientIp`, `logAdminAction(req, action,
  {target, reason, metadata})`, `auditTarget(ModelName, pk, __str__)`, `pyDatetimeStr`,
  `DEPARTMENTS`.
- `src/domain/platformops.ts` — `isFeatureEnabled`, `recordTaskHeartbeat`.
- `src/lib/fields.ts` — DRF field validation (was `rbac/drf_fields.ts` +
  `superadmin/fields.ts`; now one engine for rbac, platformops, legalops, superadmin).
- `src/domain/notifications.ts` — every `notify_*` service (`notifyBookingConfirmed(booking, ex)`,
  `notifyPayoutPaid`, ...; each takes an optional transaction `ex`), `createNotification`,
  `notifyAdmins`, `bookingAmounts`, and the **signal equivalents you must call where
  Django saves the model**: `bookingPostSave(booking, {created, oldStatus})`,
  `paymentPostSave(payment, {oldStatus})`, `messagePostSave(message, {created})`,
  `listingPostSave(listing, {created, oldPrice, oldIsAvailable})`,
  `reportPostSave(report, {created, oldStatus})`. (`createUser` already calls `onUserCreated`.)
  Python helpers now live in `src/lib/py.ts` (re-exported there for compatibility).
  `domain/notifications.ts` reads the service-fee rate and payment-method labels
  from `domain/payments.ts` (`getServiceFeeRateDec`, `PAYMENT_METHOD_LABELS`).
- `src/apps/notifications/channels.ts` — Channels equivalent over Redis:
  `AsyncWebsocketConsumer` (connect/receive/disconnect, accept, sendJson, close,
  group_add/group_send, `a.b` message type → method `a_b`), `asConsumer(Class)` for
  `wsRoute()`, `installOriginValidator()` (call it in any consumer module).
  `src/apps/notifications/ws.ts` is the reference consumer.
- Content negotiation (`?format=`, `.json` suffix, 406): `negotiatedView()` in `lib/view.ts`.
- `src/apps/notifications/channels.ts` consumers get daphne's close semantics:
  `close()` defaults to 1000, and a client close frame without a code is echoed
  with 1000 (`lib/ws.ts`, for every socket).
  `installOriginValidator()` registers Channels' AllowedHostsOriginValidator as a
  `lib/ws.ts` `addUpgradeGuard()` pre-accept hook.
