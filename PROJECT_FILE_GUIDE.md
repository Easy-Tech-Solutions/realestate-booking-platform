# Project File Guide

A file-by-file reference for the HomeKonet real-estate booking platform: a Django REST Framework backend and a React/TypeScript (Vite) frontend, deployed via Docker/Nginx.

---

## Root Configuration

| File | Purpose |
|---|---|
| `.gitignore` | Ignore rules for node_modules, Python venvs/caches, `.env` files, TLS certs, media, migration backups, IDE files, DBs, logs, build artifacts. |
| `.gitleaks.toml` | Gitleaks secret-scanner config with an allowlist for known false positives (detect-secrets hashes, `.env.example` placeholders, docs examples). |
| `.pre-commit-config.yaml` | Pre-commit hooks: Bandit (HIGH severity) on `backend/`, detect-secrets, Gitleaks history scan, general hygiene checks, no direct commits to `main`. |
| `.secrets.baseline` | detect-secrets baseline of previously reviewed "secret-shaped" strings (hashed) so scans don't re-flag them. |
| `Dockerfile.backend` | Multi-stage build for the Django backend — installs deps, copies `backend/`, starts Daphne via `docker-entrypoint.sh`. |
| `Dockerfile.frontend` | Multi-stage build for the React frontend — builds the Vite app, serves `dist/` via Nginx. |
| `MIGRATION.md` | Runbook for moving the deployment to a new server (media, `.env` secrets, `nginx/ssl/`, DNS cutover, TLS reissue). |
| `README.md` | Top-level project overview: repo layout, architecture, quick-start commands, release-check gate. |
| `docker-compose.yml` | Production stack: Redis, Django (Daphne), Celery worker, Celery beat, Nginx-fronted frontend. |
| `docker-entrypoint.sh` | Container entrypoint — runs `migrate` + `collectstatic` before exec'ing the start command. |
| `requirements.txt` | Root-level Python dependency pins used by the Docker build. |
| `skills-lock.json` | Lockfile recording the vendored `neon-postgres` Claude Code skill's source/hash. |

---

## Backend (`backend/`)

Django REST Framework API. `README.md` (legacy scaffold notes), `manage.py`, `Procfile` (Render web/worker/beat processes), `requirements.txt`, `fix_admin.py` (forces `is_staff`/`is_superuser` for admin-role users), `bandit-report.json` (security scan output), `skills-lock.json`.

Standalone/manual test scripts at the backend root:
- `test_booking.py` — ad-hoc script that POSTs a booking against a running local server.
- `test_booking_django.py` — real `APITestCase` for booking creation.
- `test_permissions.py` — ad-hoc script checking booking-detail permission rules (owner/host/stranger).
- `test_permissions_proper.py` — `APITestCase` version of the same permission checks.

`.agents/skills/neon-postgres/SKILL.md` — vendored Neon Postgres reference doc for AI-assisted development.

### `realestate_backend/` — project config
| File | Purpose |
|---|---|
| `settings.py` | Main settings: env config, installed apps/middleware, DB, DRF/JWT/CORS/CSRF, Redis/Celery, Cloudinary/Stripe/MTN MoMo/Brevo/VAPID, production hardening. |
| `urls.py` | Root URL config — mounts admin, health check, each app's `/api/*` routes, media serving. |
| `asgi.py` | ASGI entrypoint wiring HTTP + Channels websocket routing (messaging, notifications). |
| `wsgi.py` | WSGI entrypoint for traditional WSGI servers. |
| `celery.py` | Celery app entry point; loads `CELERY_*` settings and autodiscovers `tasks.py`. |
| `app_logging.py` | `log_activity`/`log_transaction` helpers emitting JSON log entries. |
| `logging_config.py` | `LOGGING` dict + JSON formatter for four rotating log files. |
| `request_log_middleware.py` | Logs one JSON entry per HTTP request (method, path, status, duration, user, IP). |
| `security_headers.py` | Adds CSP and Permissions-Policy headers (relaxed CSP for the Unfold admin). |
| `error_views.py` | Custom 404/500 handlers returning logged JSON error responses. |
| `__init__.py` | Imports the Celery app so `@shared_task` works at startup. |

### `authapp/` — authentication & JWT
- `models.py` — `BlacklistedToken` (JWT blacklist), `SocialAccount` (Google SSO links).
- `views.py` — register, verify-email, login/logout, JWT refresh (rotation/blacklisting), password reset, Google OAuth.
- `serializers.py` — `UserSerializer` with nested profile fields.
- `urls.py` — register/login/logout/refresh/me/password-reset/Google routes.
- `utils.py` — generates and emails verification/reset tokens.
- `throttles.py` — DRF rate-limit classes for login, register, reset, verify, Google login, phone-change.
- `admin.py` — registers `BlacklistedToken`, `SocialAccount`.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (2)</summary>

- `0001_initial.py` — creates `BlacklistedToken`, `SocialAccount`.
- `0002_create_cache_table.py` — creates the DB-backed cache table.

</details>

### `bookings/` — reservation lifecycle
- `models.py` — `Booking` (7-day host-confirm / 10-day payment-window lifecycle), `PaymentRequest`, `ViewingAppointment` (Saturday viewing slots), `SavedSearch`/`SearchAlert`, `PropertyComparison`/`ComparisonItem`.
- `views.py` — reservation create/confirm/decline/cancel, viewings, saved searches, comparisons, host payouts.
- `services.py` — core booking state-machine (confirm, decline, admin payment confirm, expiry, payout creation).
- `tasks.py` — Celery Beat tasks expiring unconfirmed (7d) and unpaid (10d) reservations.
- `serializers.py` — bookings, viewings, saved searches/alerts, comparisons (with computed score/pros/cons).
- `urls.py` — routes for bookings, viewings, payouts, saved searches, comparisons.
- `admin.py` — `Booking`/`ViewingAppointment`/`PaymentRequest` admin with confirm/decline/schedule actions.
- `management/commands/backfill_payouts.py` — idempotently creates missing host `Payout` records.
- `management/commands/send_search_alerts.py` — emails/creates `SearchAlert` rows for new matching listings.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (16)</summary>

- `0001_initial.py` — original `Booking` model (pending/confirmed/cancelled/completed).
- `0002_alter_booking_id.py` — converts `Booking.id` to `BigAutoField`.
- `0003_alter_booking_options_and_more.py` — renames `created_at`→`requested_at`, drops `updated_at`, adds `confirmed_at`.
- `0004_savedsearch_searchalert.py` — creates `SavedSearch`, `SearchAlert`.
- `0005_propertycomparison_comparisonitem.py` — creates `PropertyComparison`, `ComparisonItem`.
- `0006_alter_comparisonitem_notes_and_more.py` — field tweaks on `ComparisonItem.notes`/`is_public`.
- `0007_alter_savedsearch_property_type.py` — makes `SavedSearch.property_type` nullable.
- `0008_booking_total_price.py` — adds `total_price`.
- `0009_booking_hotel_room.py` — adds optional `hotel_room` FK.
- `0010_partial_unique_booking.py` — partial unique constraint scoped to "active" statuses.
- `0011_booking_stripe_payment_intent_id.py` — adds unique `stripe_payment_intent_id`.
- `0012_booking_statuses_paymentrequest.py` — expands status choices, creates `PaymentRequest`.
- `0013_booking_cancelled_at.py` — adds `cancelled_at`.
- `0014_alter_paymentrequest_id.py` — converts `PaymentRequest.id` to `BigAutoField`.
- `0015_viewingappointment_and_more.py` — creates `ViewingAppointment`.
- `0016_viewingappointment_viewing_time.py` — adds `viewing_time` (2-hour block start).

</details>

### `hostapplications/` — 3-stage host review pipeline
- `models.py` — `HostApplication` with sequential 3-stage status/stage enums, per-stage reviewer audit fields.
- `services.py` — `ps_decision`/`compliance_decision`/`supervisor_decision` advance or decline an application, promoting to `role='agent'` on final approval.
- `views.py` — submit application, fetch current user's latest application/status.
- `serializers.py` — submission (blocks duplicate active applications) and read-back serializers.
- `urls.py` — submit + "my latest application" routes.
- `admin.py` — admin decision field invoking the matching stage's service based on reviewer permission.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (2)</summary>

- `0001_initial.py` — initial `HostApplication` model with 3-stage review fields.
- `0002_create_reviewer_groups.py` — data migration creating Product Support Officers / Compliance Officers / Supervisors groups + permissions.

</details>

### `listings/` — property listings
- `models.py` — `Listing` (pricing/discounts/soft-delete), `PropertyCategory`, `ListingImage`, `Favorite`, `Review`/`ReviewImage`, `PropertyView`/`PropertyStats`, `HotelRoom`/`HotelRoomImage`.
- `views.py` — browse/CRUD listings, categories, favorites, reviews (host responses), hotel rooms/availability, pricing (nightly vs. monthly), analytics, nearby search, admin approve/reject.
- `filters.py` — `ListingFilter` (price, bedrooms, sq ft, location, owner, dates, ordering).
- `deletion.py` — `delete_listing()` — hard-deletes if no money-bearing bookings/payments, else soft-deletes.
- `middleware.py` — `ViewTrackingMiddleware` records `PropertyView` on GET, broad-excepts bad IDs (TEST-INPUT-01 fix).
- `serializers.py` — listings/categories/images/hotel rooms/favorites/reviews, amenities JSON normalization.
- `urls.py` — CRUD, categories, images, favorites, reviews, stats, pricing, availability, hotel rooms.
- `admin.py` — `Listing` (inline gallery), `ListingImage`, `Favorite`, `PropertyCategory`, scoped to owner for non-superusers.
- `management/commands/update_property_stats.py` — recomputes yesterday's per-listing `PropertyStats`.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (20)</summary>

- `0001_initial.py` — initial `Listing` model.
- `0002_auto_20260123_1529.py` — state-only alignment of `owner` field with `users` app.
- `0003_listing_bedrooms.py` — adds `bedrooms`.
- `0004_listing_main_image_listingimage.py` — adds `main_image`, creates `ListingImage`.
- `0005_favorite.py` — creates `Favorite`.
- `0006_review_reviewimage_propertystats_propertyview.py` — creates `Review`, `ReviewImage`, `PropertyStats`, `PropertyView`.
- `0007_listing_extra_fields.py` — adds amenities, bathrooms, other descriptive fields.
- `0008_review_categories_cancellation.py` — adds review sub-ratings + `cancellation_policy`.
- `0009_propertycategory_and_listing_category.py` — creates `PropertyCategory`, backfills category slugs.
- `0010_add_location_checkin_selfcheckin_fields.py` — adds city/state, check-in/out times, self-checkin fields.
- `0011_rename_homes_to_apartment.py` — data migration renaming "homes" category to "apartment".
- `0012_hotelroom.py` — creates `HotelRoom`.
- `0013_listing_status.py` — adds `status` (draft/published).
- `0014_hotelroomimage.py` — creates `HotelRoomImage`.
- `0015_listing_pending_review_status.py` — adds `pending_review` status choice.
- `0016_listing_deleted_at.py` — adds `deleted_at` for soft-deletion.
- `0017_listing_pricing_type_payment_schedule.py` — adds `pricing_type`, `payment_schedule` for long-term rentals.
- `0018_add_new_property_categories.py` — seeds Single Room / Air BnB / Whole House categories.
- `0019_alter_listing_status.py` — alters `status` field/choices.
- `0020_listing_lease_term_months.py` — adds `lease_term_months`.

</details>

### `messaging/` — real-time chat
- `models.py` — `Conversation` (participants, soft-delete, optional listing link), `Message` (text/file/reply), `MessageAttachment`.
- `consumers.py` — `ChatConsumer` WebSocket: JWT auth, send/receive, typing indicators, read receipts.
- `views.py` — list/start/delete conversations, send/edit messages (redaction, booking-gated attachments), presence, unread counts.
- `redaction.py` — strips phone numbers/emails from chat text before persisting.
- `routing.py` — wires `ws/chat/<conversation_id>/` to `ChatConsumer`.
- `serializers.py` — conversations, messages, attachments, reply snippets.
- `urls.py` — HTTP routes for conversations, messages, presence, unread count.
- `admin.py` — `Conversation`/`Message`/`MessageAttachment` with inline display.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (4)</summary>

- `0001_initial.py` — creates `Conversation`, `Message`, `MessageAttachment`.
- `0002_messaging_features.py` — adds `edited_at` and related fields.
- `0003_message_reply_to.py` — adds `reply_to` self-FK.
- `0004_alter_conversation_deleted_by.py` — alters `deleted_by` M2M.

</details>

### `newsletter/` — mailing list
- `models.py` — `Subscriber` (email, interests, unsubscribe token/helper).
- `views.py` — subscribe/re-subscribe, unsubscribe via token, admin list.
- `serializers.py` — subscribe input + read-only output.
- `urls.py` — subscribe, unsubscribe, admin list routes.
- `admin.py` — `Subscriber` with email/active-status search & filter.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (1)</summary>

- `0001_initial.py` — creates `Subscriber`.

</details>

### `notifications/` — in-app + email + push notifications
- `models.py` — `NotificationType` choices, `Notification`, `NotificationPreference`, `DeviceToken` (Web Push).
- `services.py` — central creation service with a helper per event type; persists, pushes over WebSocket, queues email/push tasks.
- `signals.py` — `pre_save`/`post_save` receivers on Booking/Payment/Message/Listing/Report/User calling `services.py`.
- `tasks.py` — Celery tasks rendering/sending notification emails and dispatching Web Push.
- `consumers.py` — `NotificationConsumer` WebSocket, per-user group, unread counts.
- `push_service.py` — sends Web Push via pywebpush/VAPID, prunes stale subscriptions.
- `views.py` — viewset for list/read/delete + read/unread actions; VAPID key, device registration, preferences views.
- `routing.py` — wires `ws/notifications/` to `NotificationConsumer`.
- `serializers.py` — `Notification` output, `NotificationPreference` get/patch.
- `urls.py` — preferences, device token, VAPID key, notification viewset router.
- `admin.py` — `Notification`/`NotificationPreference` registration.
- `tests.py` — empty placeholder.
- `management/commands/generate_vapid_keys.py` — generates/prints a VAPID keypair.
- `apps.py` / `__init__.py` (+ `management/__init__.py`, `management/commands/__init__.py`) — Django app boilerplate.
<details><summary>Migrations (10)</summary>

- `0001_initial.py` — creates `Notification`, `NotificationPreference`.
- `0002_notificationpreference_report_submitted_email_and_more.py` — adds `report_submitted_email` + related fields.
- `0003_notificationpreference_phone_number_changed_email_and_more.py` — adds `phone_number_changed_email`.
- `0004_notificationpreference_account_reinstated_email_and_more.py` — adds `account_reinstated_email`.
- `0005_devicetoken.py` — creates `DeviceToken`.
- `0006`–`0010_alter_notification_notification_type.py` — successive alterations to `notification_type` choices.

</details>

### `payments/` — MTN MoMo / Stripe payments
- `models.py` — `PaymentGateway`, `Currency`, `Payment` (booking or viewing-fee), `Refund`, `Payout` (host disbursement), `SavedCard`, `PlatformFee` singleton, `WebhookLog`.
- `services.py` — `PaymentService`: create/process/verify MTN MoMo payments, handle webhooks, route confirmed payments, owner disbursement & refunds.
- `gateways/base.py` — abstract `PaymentGatewayBase` interface (process/verify/refund/validate_webhook).
- `gateways/mtn_momo.py` — `MTNMoMoGateway`: Collection (request-to-pay) + Disbursement APIs, OAuth2 token caching, phone validation, webhook HMAC verification.
- `views.py` — initiate/verify MoMo payments, refunds, admin payout management, MTN/Stripe webhook receivers, Stripe PaymentIntent creation, saved card CRUD.
- `serializers.py` — initiate/verify payments & viewing-fee payments, refunds, saved cards, MTN webhook payloads.
- `urls.py` — payment initiation/verification/refunds, admin payouts, webhooks, PaymentIntent, saved cards.
- `admin.py` — `PaymentGateway`/`Currency`/`Payment`/`Refund`/`PlatformFee`/`Payout`/`WebhookLog`, payout "mark paid" action.
- `tests.py` — empty default stub.
- `tests/test_mtn_gateway.py` — standalone script manually exercising `MTNMoMoGateway.process_payment`.
- `management/commands/init_currencies.py` — seeds LRD/USD `Currency` rows.
- `management/commands/provision_mtn_sandbox.py` — provisions an MTN MoMo sandbox API user/key.
- `management/commands/reconcile_payments.py` — re-runs idempotent post-payment side effects for completed payments.
- `apps.py` / `__init__.py` (+ `gateways/__init__.py`) — Django app boilerplate.
<details><summary>Migrations (7)</summary>

- `0001_initial.py` — creates `Currency`, `PaymentGateway`, `Payment`, `Refund`, `WebhookLog`.
- `0002_payment_completed_status_gateway_urls.py` — adds sandbox/live URLs, `completed` status.
- `0003_savedcard.py` — creates `SavedCard`.
- `0004_platformfee.py` — creates `PlatformFee` singleton.
- `0005_alter_platformfee_id.py` — converts `PlatformFee.id` to `BigAutoField`.
- `0006_platformfee_service_fee_percent_and_more.py` — adds `service_fee_percent`/`viewing_fee`, creates `Payout`.
- `0007_payment_purpose_payment_viewing_and_more.py` — adds `purpose` + optional `viewing` FK; `booking` becomes optional.

</details>

### `reports/` — user-submitted moderation reports
- `models.py` — `Report` (report type, targeted content, status workflow, screenshot/owner_name for anonymous targets).
- `views.py` — file/list/view reports, admin moderation (list, stats, status update), notifies admins/reporters.
- `serializers.py` — creation (content-type-specific FK validation), read, admin status update.
- `urls.py` — user report list/create/detail, admin list/stats/status-update.
- `admin.py` — colored status display, auto-stamps `resolved_by`/`resolved_at`.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (2)</summary>

- `0001_initial.py` — creates `Report`.
- `0002_add_screenshot_owner_name.py` — adds `owner_name`, `screenshot`.

</details>

### `support/` — contact form & support tickets
- `models.py` — `ContactInquiry`, `SupportTicket` (ticket numbers, status/priority, guest or user requester), `TicketMessage`, `TicketAttachment`.
- `views.py` — public contact form & ticket creation/search (spins up a linked messaging `Conversation`), user ticket detail/reply, admin management with stats.
- `serializers.py` — contact inquiries, tickets (list/detail/create/admin-update), messages, attachments.
- `urls.py` — contact submission, ticket list/detail/messages, resolved-ticket search, admin management/stats.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (2)</summary>

- `0001_initial.py` — creates `ContactInquiry`, `SupportTicket`, `TicketMessage`, `TicketAttachment`.
- `0002_support_conversations.py` — links inquiries/tickets to messaging `Conversation`s.

</details>

### `suspensions/` — account suspensions
- `models.py` — `Suspension` (type, status, duration, revocation) with `is_currently_active`, `revoke()`/`mark_expired()`.
- `middleware.py` — blocks requests from actively suspended users (403 JSON) via session or manually-decoded JWT.
- `signals.py` — sends "suspended"/"reinstated" notifications on create/status transitions.
- `tasks.py` — `expire_suspensions()` Celery task marking past-due suspensions expired.
- `views.py` — admin-only list/create/view/revoke, per-user history, aggregate stats.
- `serializers.py` — create/read/revoke with validation (no staff/superuser targets, no duplicate active, date rules).
- `urls.py` — list/create, view, revoke, per-user history, stats.
- `admin.py` — colored status display, issuing/revocation bookkeeping, notifications.
- `apps.py` / `__init__.py` — Django app boilerplate (wires signals on `ready()`).
<details><summary>Migrations (1)</summary>

- `0001_initial.py` — creates `Suspension` (depends on `reports` and the user model).

</details>

### `testimonials/` — marketing testimonials
- `models.py` — `Testimonial` (name, rating, quote, avatar color/initials, cyclic color assignment).
- `views.py` — public GET / authenticated POST, admin-only PUT/DELETE.
- `serializers.py` — read (with avatar info) and authenticated create.
- `urls.py` — collection + per-item admin update/delete.
- `admin.py` — inline `is_active` editing.
- `apps.py` / `__init__.py` — Django app boilerplate.
<details><summary>Migrations (2)</summary>

- `0001_initial.py` — creates `Testimonial`.
- `0002_testimonial_user.py` — adds `user` FK.

</details>

### `users/` — accounts & profiles
- `models.py` — custom `User` (roles, verification/reset tokens, archive/delete fields), `Profile` (bio, image, momo_number, superhost), `PhoneChangeRequest` (2-step OTP).
- `views.py` — user listing, admin stats, user detail, dashboard, profile updates, soft-deletion, 2-step phone-change flow.
- `deletion.py` — `delete_account()` — blocks if active bookings exist, else soft-deletes/anonymizes, wipes PII, blacklists tokens.
- `signals.py` — auto-creates/saves a `Profile` whenever a `User` is created/saved.
- `utils.py` — OTP generation + email/SMS helpers for phone-change.
- `serializers.py` — public/private user & profile representations.
- `urls.py` — user listing/detail, dashboard, profile update, deletion, phone-change routes.
- `admin.py` — `User` (Profile inline, bulk "reactivate archived accounts" action), `Profile`.
- `management/commands/fix_admin_permissions.py` — repairs admin/staff/superuser flags for a given (or all) admin user(s).
- `apps.py` / `__init__.py` — Django app boilerplate (wires signals on `ready()`).
<details><summary>Migrations (14)</summary>

- `0001_initial.py` — creates the custom `User` model.
- `0002_auto_20260123_1455.py` — adds `role`.
- `0003_user_picture.py` — adds `picture` ImageField.
- `0004_alter_user_picture.py` — makes `picture` blank-allowed.
- `0005_remove_user_picture_profile.py` — removes `picture`, creates `Profile`.
- `0006_profile_momo_number.py` — adds `momo_number`.
- `0007_alter_profile_momo_number.py` — updates `momo_number` help text/format.
- `0008_add_password_reset_token.py` — adds `password_reset_token`.
- `0009_phonechangerequest.py` — creates `PhoneChangeRequest`.
- `0010_profile_superhost.py` — adds `is_superhost`.
- `0011_user_token_expiry.py` — adds verification/reset token expiry timestamps.
- `0012_profile_last_seen.py` — adds `last_seen`.
- `0013_user_deleted_at.py` — adds `deleted_at`.
- `0014_user_archive_fields.py` — adds `is_archived`, `archived_at`, `scheduled_deletion_at`.

</details>

### Other backend files
| File | Purpose |
|---|---|
| `scripts/prelaunch_check.py` | Pre-launch validation (DEBUG/secret-key/hosts/DB/migrations/cache/email/Celery/CORS/MTN readiness), PASS/WARN/FAIL output. |
| `static/admin/Home-Konet-Logo2.jpeg` | Logo used to brand the Django admin (Unfold `SITE_ICON`). |

**`templates/`** — email & auth landing pages:
<details><summary>Auth pages/emails (4)</summary>

- `auth/password_reset_email.html` — password reset link email.
- `auth/verification_email.html` — email-verification link email.
- `auth/verification_failure.html` — landing page for invalid/failed verification links.
- `auth/verification_success.html` — landing page for successful verification.

</details>
<details><summary>Notification emails (23 + 2 base layouts)</summary>

- `emails/base_email.html` / `emails/notifications/base_email.html` — shared header/footer layouts.
- `account_reinstated.html`, `account_suspended.html` — account status change emails.
- `booking_cancelled.html`, `booking_completed.html`, `booking_confirmed.html`, `booking_declined.html`, `booking_ready_to_pay.html`, `booking_requested.html`, `booking_submitted.html` — booking lifecycle emails (to guest or host as applicable).
- `generic.html` — fallback template for notification types without a dedicated template.
- `host_application_advanced.html`, `host_application_approved.html`, `host_application_declined.html`, `host_application_submitted.html` — host application pipeline emails.
- `listing_available.html`, `price_changed.html` — saved-listing alert emails.
- `new_message.html` — new chat message email.
- `payment_failed.html`, `payment_received.html`, `payment_received_host.html`, `payment_refunded.html` — payment lifecycle emails.
- `payout_paid.html` — host payout confirmation.
- `viewing_fee_paid.html` — viewing-fee payment receipt.
- `emails/search_alert.html` — new listing matches a saved search alert.

</details>

---

## Frontend (`frontend/`)

React 18 + TypeScript + Vite SPA.

### Config & entry
| File | Purpose |
|---|---|
| `package.json` | npm manifest — Radix UI, TanStack Query, Stripe, Leaflet, Zustand, Tailwind v4, dev/build/lint/typecheck scripts. |
| `vite.config.ts` | React + Tailwind plugins, `@` path alias, manual vendor code-splitting. |
| `tsconfig.json` | TS compiler config (ES2022, strict, bundler resolution, JSX react-jsx). |
| `eslint.config.js` | Flat ESLint config (typescript-eslint, React Hooks/Refresh), relaxed for shadcn `ui/` files. |
| `vercel.json` | Vercel build output dir + SPA rewrite. |
| `index.html` | Vite HTML entry point (title, favicon, mounts `main.tsx`). |
| `postcss.config.mjs` | Empty placeholder — Tailwind v4's Vite plugin handles PostCSS. |
| `.env.example` | Documents `VITE_API_URL`, `VITE_WS_URL`, Google OAuth client ID, Stripe publishable key. |
| `src/main.tsx` | React DOM entry — clears stale-chunk flag, renders `<App/>`, imports global/Leaflet CSS. |
| `src/vite-env.d.ts` | Vite client type reference for `import.meta.env`. |
| `src/app/App.tsx` | Root component — `GoogleOAuthProvider` + `AppProvider` + router. |
| `src/app/routes.tsx` | React Router route tree (lazy pages, `ProtectedRoute` guards, chunk-load-error fallback). |
| `.vite/deps/*` | Vite's auto-generated dependency pre-bundling cache (not hand-maintained). |

### Docs
- `README.md` — tech stack, project structure, routing table, global state, feature flows (partly describes an earlier mock-data-only version).
- `ARCHITECTURE.md` — layered API architecture (client/errors/normalizers/domain APIs/query hooks/providers).
- `PROJECT_OVERVIEW.md` — legacy "StayBnB" pre-backend overview.
- `ATTRIBUTIONS.md` — shadcn/ui (MIT) and Unsplash photo credits.
- `guidelines/Guidelines.md` — empty placeholder for AI design/coding guidelines.

### Pages (`src/app/pages/`)
| Page | Purpose |
|---|---|
| `Home.tsx` | Landing page — hero, categories, featured grid, testimonials, search/auth entry points. |
| `Search.tsx` | Search results with Leaflet map view, filters dialog, property grid. |
| `PropertyDetails.tsx` | Listing detail — gallery, amenities, host info, calendar, live pricing, reviews, booking/viewing CTAs. |
| `Booking.tsx` | Free reservation review/confirm (no payment yet). |
| `BookingConfirmed.tsx` | Post-reservation confirmation + downloadable receipt. |
| `CompletePayment.tsx` | Stripe card or MTN MoMo payment for a confirmed booking (with async MoMo polling). |
| `RequestViewing.tsx` | Schedule + pay for a Saturday in-person viewing. |
| `Viewings.tsx` | User's scheduled viewings; reserve a property after a completed viewing. |
| `Trips.tsx` | Upcoming/past bookings, cancel, post-stay reviews. |
| `Wishlists.tsx` | Saved/favorited properties grid. |
| `AllReviews.tsx` | Platform-wide reviews with sorting and sub-rating detail. |
| `Login.tsx` | Combined login/signup, email+password and Google OAuth. |
| `ResetPassword.tsx` | Password reset confirmation via URL token. |
| `VerifyEmail.tsx` | Email verification landing page. |
| `Account.tsx` | Profile photo, saved cards, password/security, notification prefs. |
| `UserDashboard.tsx` | Guest dashboard — trips, favorites, reviews, spend. |
| `Notifications.tsx` | Notification center, categorized, read/unread, deep links. |
| `Messages.tsx` | Real-time chat over WebSocket — threads, read receipts, typing, edit/delete/reply, attachments. |
| `BecomeAHost.tsx` | Host application form/status (3-stage review pipeline). |
| `CreateListing.tsx` | Multi-step listing-creation wizard (type, location, basics, amenities, photos, pricing, hotel rooms). |
| `ManageRooms.tsx` | Manage individual hotel rooms under a hotel listing. |
| `HostDashboard.tsx` | Host control panel — listings, bookings, messages, earnings charts, reviews. |
| `HostProfile.tsx` | Public host profile — bio, superhost badge, listings, reviews. |
| `AdminDashboard.tsx` | Admin panel — users, properties (incl. approvals), bookings, payments, payouts, tickets, security stats. |
| `AdminReports.tsx` | Admin moderation of user-submitted reports. |
| `AdminSuspensions.tsx` | Admin creation/listing/revocation of account suspensions. |
| `Support.tsx` | Help-center flow — categories, article search, ticket submission. |
| `MyTickets.tsx` | User's support ticket list/detail/reply. |
| `Contact.tsx` | Contact-us form. |
| `Help.tsx` | Searchable FAQ accordion. |
| `FAQ.tsx` | Static categorized FAQ (icon-category variant). |
| `About.tsx` | "About HomeKonet" marketing page. |
| `Terms.tsx` / `Privacy.tsx` | Static legal content pages. |
| `NotFound.tsx` | 404 fallback. |

### Components (`src/app/components/`)
| Component | Purpose |
|---|---|
| `Header.tsx` | Top nav — logo, search trigger, auth dialog, user menu, "become a host". |
| `Footer.tsx` | Site footer — newsletter signup, link columns. |
| `MobileNav.tsx` | Bottom mobile nav, prompts login for protected tabs. |
| `AuthDialog.tsx` | Login/register/forgot-password modal, Google OAuth, password strength. |
| `SearchDialog.tsx` | Search modal — destination, date range, guest counters. |
| `FiltersDialog.tsx` | Search filters modal — price, type, amenities, beds/baths, toggles. |
| `PropertyCard.tsx` | Listing card — auto-rotating carousel, wishlist toggle, price/rating. |
| `ReportDialog.tsx` | Report a user/listing/review/message, with screenshot upload. |
| `ConfirmDialog.tsx` | Generic confirm/cancel `AlertDialog` wrapper. |
| `NewsletterSignup.tsx` | Email + name newsletter subscription form. |
| `LiberiaMap.tsx` | Leaflet helpers — marker icon fix, Liberia/Monrovia centers, brand map markers. |
| `LoadingSpinner.tsx` | Full-screen loading spinner. |
| `Skeletons.tsx` | Skeleton placeholders for cards/grids/detail pages. |
| `ProtectedRoute.tsx` | Route guard — redirects based on auth/host/admin requirements. |
| `figma/ImageWithFallback.tsx` | Image wrapper with inline SVG placeholder on load failure. |

<details><summary>UI primitives (<code>components/ui/*.tsx</code> — 41 files, shadcn/Radix-based)</summary>

Generic, mostly styling-only wrappers around Radix primitives and small libraries: `accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `avatar`, `badge`, `breadcrumb`, `button`, `calendar` (react-day-picker), `card`, `carousel` (Embla), `chart` (Recharts), `checkbox`, `collapsible`, `command` (cmdk), `context-menu`, `dialog`, `drawer` (Vaul), `dropdown-menu`, `form` (react-hook-form), `hover-card`, `input-otp`, `input`, `label`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable` (react-resizable-panels), `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner` (toasts), `switch`, `table`, `tabs`, `textarea`, `toggle-group`, `toggle`, `tooltip`.
Plus `use-mobile.ts` (mobile breakpoint hook) and `utils.ts` (`cn()` class-merge helper).

</details>

### Layouts
- `src/app/layouts/RootLayout.tsx` — app shell (Header/Footer/MobileNav around a Suspense route `Outlet`; hides chrome on host-dashboard/booking pages).

### Hooks (`src/hooks/`)
| Hook | Purpose |
|---|---|
| `useApp.ts` | Exposes the Zustand `useAppStore` as `useApp()`. |
| `useChatSocket.ts` | WebSocket hook for chat — messages, edits, read receipts, typing. |
| `useNotificationSocket.ts` | WebSocket hook for notifications — toasts + cache invalidation. |
| `usePushNotifications.ts` | Registers browser push once authenticated. |
| `useUserLocation.ts` | Wraps the Geolocation API. |

<details><summary>Query hooks (<code>hooks/queries/*.ts</code> — 12 files, TanStack Query)</summary>

- `keys.ts` — centralized query key factory.
- `useBookingConfirmed.ts` — booking + property for the confirmation page.
- `useHomeProperties.ts` — all/category-filtered properties for Home.
- `useHostDashboard.ts` — host dashboard data, per-listing reviews, update/delete mutations.
- `useHostProfile.ts` — host info, listings, aggregated reviews.
- `useMessages.ts` — conversations, messages, send mutation.
- `usePropertyDetails.ts` — property + reviews + availability.
- `usePropertyPricing.ts` — live pricing for date range/room.
- `useSearchProperties.ts` — search against current filters.
- `useTrips.ts` — user bookings, cancel/review mutations.
- `useUserDashboard.ts` — aggregated dashboard (bookings, favorites, reviews, spend).
- `useWishlists.ts` — favorited properties.

</details>

### Services / API layer (`src/services/`)
- `api.service.ts` — compatibility facade re-exporting `services/api/index.ts`.
- `mock-data.ts` — legacy mock dataset from the pre-backend prototype phase.

<details><summary>Domain API modules (<code>services/api/*.ts</code> — 19 files + shared/)</summary>

- `index.ts` — barrel re-exporting all domain modules and shared types.
- `auth.ts` — login, register, verification, Google login, password reset, current user.
- `bookings.ts` — create/get/list/cancel/confirm/decline a booking.
- `booking-tools.ts` — saved searches, search alerts, property comparisons.
- `dashboard.ts` — combined dashboard payload + agent analytics.
- `hostApplications.ts` — submit/fetch host application (with file upload).
- `messages.ts` — conversations, threads, send (with attachments), edit.
- `newsletter.ts` — subscribe/unsubscribe, admin list.
- `notifications.ts` — list/read/delete, preferences, VAPID key, device token.
- `payments.ts` — initiate Stripe/MoMo payments, saved cards.
- `payouts.ts` — admin payout list + mark-paid.
- `properties.ts` — search, get by id/category/host, featured, categories, availability, pricing.
- `reports.ts` — submit + admin list/update-status, screenshot upload.
- `reviews.ts` — paginated listing + creation.
- `support.ts` — tickets, messages/attachments, contact inquiries, article search.
- `suspensions.ts` — admin list/create/revoke, user history.
- `testimonials.ts` — fetch + submit.
- `users.ts` — fetch/list/admin-stats/delete/suspend/update profile.
- `viewings.ts` — available slots, request/reserve, own viewings.
- `wishlists.ts` — derives wishlist from dashboard favorites payload.

**`shared/`**
- `client.ts` — authenticated fetch client, in-memory token storage, refresh-cookie handling.
- `contracts.ts` — raw backend response type contracts pre-normalization.
- `errors.ts` — `ApiError` class + `getErrorMessage()`.
- `normalizers.ts` — raw JSON → frontend type converters.

</details>

### Core, state, styling
| File | Purpose |
|---|---|
| `core/types.ts` | Central TS type definitions (User, Property, Booking, Review, etc.). |
| `core/constants.ts` | API/WS base URLs, property categories, amenities list. |
| `core/bookingStatus.ts` | `BookingStatus` → label + badge class mapping. |
| `core/icon-map.ts` | Amenity/icon keys → Lucide icon components. |
| `core/push.ts` | Web Push subscribe/unsubscribe helpers. |
| `core/utils.ts` | `cn()`, currency/date formatting, pricing calculations. |
| `store/appStore.ts` | Zustand persisted store — auth state, login/register/logout, search filters, wishlist. |
| `providers/AppProvider.tsx` | Top-level provider — auth init + Query/Realtime providers. |
| `providers/QueryProvider.tsx` | Shared TanStack `QueryClient` config. |
| `providers/RealtimeProvider.tsx` | Wires notification WebSocket + push registration. |
| `styles/theme.css` | Design-system color tokens (primary green `#004406`, light/dark). |
| `styles/tailwind.css` | Tailwind v4 import + `scrollbar-hide` utility. |
| `styles/index.css` | Global stylesheet entry (fonts/tailwind/theme/leaflet). |
| `styles/fonts.css` | Font-face declarations (currently empty). |

### Assets & public
- `assets/logo2.jpg`, `assets/banner.jpeg`, `assets/google.png`, `assets/apple.png` — brand/logo/social-login images.
- `public/favicon.jpg` — site favicon.
- `public/sw.js` — service worker for Web Push (`push`, `notificationclick`).

---

## Docs (`docs/`)
| File | Purpose |
|---|---|
| `DEPLOYMENT.md` | Full production deployment guide — Docker Compose and Render/PaaS paths, hardening, TLS, backups, checklist. |
| `SECURITY_TESTING.md` | Security test case catalog (TEST-AUTH/AUTHZ/INPUT/BIZ-*) with recorded findings/fixes. |
| `integration.md` | End-to-end frontend↔backend integration guide — auth flow, API map, WebSockets, MTN MoMo, CORS, go-live checklist. |
| `backend/infrastructure-production.md` | Linux production setup for the Django backend (systemd, Nginx, TLS, same-origin cookie requirement). |
| `frontend/frontend-architecture.md` | Deep-dive frontend reference — provider chain, routing, state architecture, file-by-file guide. |
| `frontend/infrastructure-production.md` | Linux production deployment for the frontend (Vite env, Nginx static hosting). |
| `Project Documentation.docx` | Supplementary binary Word document. |

## Nginx
- `nginx/nginx.conf` — production config for homekonet.com: HTTPS redirect, TLS termination, security headers, gzip, proxies `/ws/` and `/api/`, serves `/static/`/`/media/`, SPA fallback.

## Scripts (`scripts/`)
| File | Purpose |
|---|---|
| `backup.sh` | Bundles media, `.env` files, and `nginx/ssl` into a GPG-encrypted tarball. |
| `restore.sh` | Restores a `backup.sh` archive onto a fresh clone (refuses to overwrite existing `backend/.env` without `--force`). |
| `install-certbot-hooks.sh` | Installs Certbot renewal hooks to swap the cert and restart the frontend container. |
| `release-check.sh` | Pre-release gate — Django checks + `prelaunch_check.py`, frontend lint/typecheck/build. |

## Testing (`testing/`)
- `testing-guide.md` — combined backend+frontend testing guide (setup, test commands, integration order, troubleshooting, CI recommendation).
- `backend/README.md` — what to store in the backend testing folder and how to run the test suite/scripts.
