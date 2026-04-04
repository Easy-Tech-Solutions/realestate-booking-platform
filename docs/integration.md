# Integration Guide — Real Estate Booking Platform

This document covers every step required to connect the React frontend to the Django backend, configure shared services, and run the full stack locally or in production.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Environment Variables](#3-environment-variables)
4. [Backend Setup](#4-backend-setup)
5. [Frontend Setup](#5-frontend-setup)
6. [Running the Full Stack](#6-running-the-full-stack)
7. [Authentication Flow](#7-authentication-flow)
8. [API Endpoint Map](#8-api-endpoint-map)
9. [WebSocket Integration](#9-websocket-integration)
10. [Payments Integration](#10-payments-integration)
11. [Real-Time Notifications](#11-real-time-notifications)
12. [Media Files](#12-media-files)
13. [Celery & Background Tasks](#13-celery--background-tasks)
14. [CORS Configuration](#14-cors-configuration)
15. [Pages Using Mock Data](#15-pages-using-mock-data)
16. [Production Checklist](#16-production-checklist)

---

## 1. Architecture Overview

```
Browser
  │
  ├── HTTP/REST ──► Django (port 8000)  — DRF + SimpleJWT
  │                      │
  │                      ├── SQLite (dev) / PostgreSQL (prod)
  │                      ├── Redis (channel layer + Celery broker)
  │                      └── Celery worker (background tasks)
  │
  └── WebSocket ──► Daphne / Django Channels (same port 8000)
                         ├── ws://localhost:8000/ws/chat/<id>/
                         └── ws://localhost:8000/ws/notifications/
```

- **Frontend**: React 18, Vite, TypeScript — runs on `http://localhost:5173`
- **Backend**: Django 5, Django REST Framework, Daphne ASGI — runs on `http://localhost:8000`
- **Auth**: JWT via `djangorestframework-simplejwt` (access token 15 min, refresh token 1 day)
- **Real-time**: Django Channels over WebSocket, backed by Redis (or in-memory in dev)
- **Payments**: MTN Mobile Money gateway

---

## 2. Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| Python | 3.11+ | |
| Node.js | 18+ | |
| pnpm | 8+ | `npm i -g pnpm` |
| Redis | 7+ | Optional in dev — in-memory fallback is used if `REDIS_URL` is unset |
| Git | any | |

---

## 3. Environment Variables

### Backend — `backend/.env`

Copy from `backend/.env.example` and fill in values:

```env
DJANGO_SECRET_KEY=change-me-in-production
DJANGO_DEBUG=true
FRONTEND_ORIGIN=http://localhost:5173

# Email (console backend used in dev — no SMTP needed)
EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
DEFAULT_FROM_EMAIL=

# Domain
LOCAL_DOMAIN=localhost:8000
SITE_NAME=Real Estate Booking Platform

# MTN Mobile Money
MTN_MOMO_API_KEY=
MTN_MOMO_USER_ID=
MTN_MOMO_API_SECRET=
MTN_BUSINESS_NUMBER=

# Redis — leave blank in dev to use the in-memory channel layer
REDIS_URL=

# Set to true in dev so Celery tasks run synchronously (no worker needed)
CELERY_ALWAYS_EAGER=true
```

### Frontend — `frontend/.env`

Copy from `frontend/.env.example`:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

These values are consumed by `src/core/constants.ts`:

```ts
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const WS_BASE_URL  = import.meta.env.VITE_WS_URL  || 'ws://localhost:8000';
```

---

## 4. Backend Setup

```bash
cd backend

# 1. Create and activate a virtual environment
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Create the .env file
cp .env.example .env
# Edit .env with your values

# 4. Apply database migrations
python manage.py migrate

# 5. Create the rate-limit cache table (required by DatabaseCache)
python manage.py createcachetable

# 6. Create a superuser (optional but useful)
python manage.py createsuperuser

# 7. Start the ASGI server (serves both HTTP and WebSocket)
python manage.py runserver
```

The backend will be available at `http://localhost:8000`.  
The Django admin panel is at `http://localhost:8000/admin/`.

---

## 5. Frontend Setup

```bash
cd frontend

# 1. Install dependencies
pnpm install

# 2. Create the .env file
cp .env.example .env
# Adjust VITE_API_URL / VITE_WS_URL if needed

# 3. Start the dev server
pnpm dev
```

The frontend will be available at `http://localhost:5173`.

---

## 6. Running the Full Stack

Open three terminals:

**Terminal 1 — Django backend**
```bash
cd backend && python manage.py runserver
```

**Terminal 2 — Celery worker** *(only needed in production or when `CELERY_ALWAYS_EAGER=false`)*
```bash
cd backend && celery -A realestate_backend worker --loglevel=info
```

**Terminal 3 — React frontend**
```bash
cd frontend && pnpm dev
```

Open `http://localhost:5173` in your browser.

---

## 7. Authentication Flow

The frontend uses JWT stored in `localStorage`. The entire flow lives in `frontend/src/services/api.service.ts`.

```
1. User submits login form
      ↓
2. POST /api/auth/login/  { username, password }
      ↓
3. Backend returns { access, refresh, user }
      ↓
4. Frontend stores tokens via setTokens()
   — localStorage['accessToken']
   — localStorage['refreshToken']
      ↓
5. All subsequent requests include:
   Authorization: Bearer <accessToken>
      ↓
6. If any request returns 401:
   POST /api/auth/refresh-token/  { refresh }
      ↓
7. On success → update accessToken, retry original request
   On failure → clearTokens(), redirect to login
```

### Auth Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register/` | Create account |
| POST | `/api/auth/verify-email/` | Verify email with token |
| POST | `/api/auth/login/` | Obtain access + refresh tokens |
| POST | `/api/auth/logout/` | Blacklist refresh token |
| POST | `/api/auth/refresh-token/` | Rotate access token |
| GET | `/api/auth/me/` | Get current user |
| POST | `/api/auth/password-reset/` | Request password reset email |
| POST | `/api/auth/password-reset-confirm/` | Confirm new password with token |

---

## 8. API Endpoint Map

All REST endpoints are prefixed with `http://localhost:8000`.

### Listings

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/listings/` | List / create listings |
| GET/PUT/DELETE | `/api/listings/<id>/` | Retrieve / update / delete listing |
| GET/POST | `/api/listings/<id>/images/` | Manage listing images |
| POST/DELETE | `/api/listings/<id>/favorite/` | Add / remove favorite |
| GET | `/api/listings/favorites/` | Get current user's favorites |
| GET | `/api/listings/<id>/reviews/` | Get reviews for a listing |
| POST | `/api/listings/reviews/create/` | Create a review |
| DELETE | `/api/listings/reviews/<id>/` | Delete a review |
| GET | `/api/listings/analytics/agent/` | Agent analytics summary |
| GET | `/api/listings/analytics/popular/` | Popular listings |

### Bookings

| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/bookings/` | List / create bookings |
| GET/DELETE | `/api/bookings/<id>/` | Get / cancel booking |
| POST | `/api/bookings/<id>/confirm/` | Confirm a booking (host) |
| POST | `/api/bookings/<id>/decline/` | Decline a booking (host) |
| GET | `/api/bookings/pending/` | List pending bookings |
| GET/POST | `/api/bookings/searches/` | Saved searches |
| GET/DELETE | `/api/bookings/searches/<id>/` | Manage a saved search |
| GET/POST | `/api/bookings/comparisons/` | Property comparisons |

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/api/users/me/dashboard/` | User dashboard data |
| PUT/PATCH | `/api/users/me/profile/` | Update profile |

### Payments

| Method | Path | Description |
|---|---|---|
| POST | `/api/payments/initiate/` | Initiate MTN MoMo payment |
| GET | `/api/payments/<uuid>/` | Get payment detail / status |
| POST | `/api/payments/verify/` | Verify payment |
| POST | `/api/payments/webhooks/mtn_momo/` | MoMo webhook callback |

### Messaging

| Method | Path | Description |
|---|---|---|
| GET | `/api/messaging/conversations/` | List conversations |
| POST | `/api/messaging/conversations/start/` | Start a new conversation |
| GET | `/api/messaging/conversations/<id>/messages/` | List messages |
| POST | `/api/messaging/conversations/<id>/messages/send/` | Send a message |
| GET | `/api/messaging/unread-count/` | Unread message badge count |

### Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications/` | List notifications |
| POST | `/api/notifications/<id>/read/` | Mark one as read |
| POST | `/api/notifications/read-all/` | Mark all as read |
| GET | `/api/notifications/unread-count/` | Unread count |
| GET/PUT | `/api/notifications/preferences/` | Notification preferences |

---

## 9. WebSocket Integration

Django Channels handles WebSocket connections through Daphne. Two channels are exposed:

### Chat

```
ws://localhost:8000/ws/chat/<conversation_id>/
```

- Requires a valid JWT — pass it as a query parameter or in the handshake header.
- Messages are broadcast to all participants in the conversation.
- The frontend should connect when a conversation view is opened and disconnect on unmount.

### Notifications

```
ws://localhost:8000/ws/notifications/
```

- Delivers real-time notification events to the authenticated user.
- The frontend should connect once after login and keep the socket open for the session.

### Connection example (frontend)

```ts
import { WS_BASE_URL } from '../core/constants';
import { getAccessToken } from '../services/api.service';

const token = getAccessToken();
const socket = new WebSocket(`${WS_BASE_URL}/ws/notifications/?token=${token}`);

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // handle notification data
};
```

> **Dev note**: In development, Django Channels uses `InMemoryChannelLayer` (no Redis required). In production set `REDIS_URL` so all processes share the same channel layer.

---

## 10. Payments Integration

The platform uses **MTN Mobile Money** as its payment gateway.

### Flow

```
1. POST /api/payments/initiate/
   Body: { booking_id, phone_number, gateway: "mtn_momo" }
   Response: { payment_id, status }

2. Poll or use webhook to check status:
   GET /api/payments/<payment_id>/

3. MTN calls back your server:
   POST /api/payments/webhooks/mtn_momo/
```

### Required environment variables

```env
MTN_MOMO_API_KEY=
MTN_MOMO_USER_ID=
MTN_MOMO_API_SECRET=
MTN_BUSINESS_NUMBER=
```

A sandbox URL is used automatically when `DJANGO_DEBUG=true`. Set `DJANGO_DEBUG=false` in production to switch to the live MTN endpoint.

---

## 11. Real-Time Notifications

Notifications are sent to users through two mechanisms:

1. **REST polling** — `GET /api/notifications/` on page focus or a timed interval.
2. **WebSocket push** — `ws://localhost:8000/ws/notifications/` delivers events instantly.

The `notifications` app emits signals (`backend/notifications/signals.py`) that trigger the `NotificationConsumer` to push events over the WebSocket channel.

---

## 12. Media Files

Uploaded images (listing photos, profile pictures, message attachments) are handled by Django's media file system.

- **Dev**: files are saved to `backend/media/` and served by Django at `/media/`.
- **Prod**: configure a CDN or object storage (S3, Cloudflare R2) and update `MEDIA_URL` / `DEFAULT_FILE_STORAGE` in `settings.py`.

The `MEDIA_ROOT` directory is created automatically on startup (`os.makedirs(MEDIA_ROOT, exist_ok=True)` in `settings.py`).

---

## 13. Celery & Background Tasks

Celery is used for asynchronous tasks (e.g. sending emails, processing payment callbacks).

### Development

Set `CELERY_ALWAYS_EAGER=true` in `backend/.env` — tasks run synchronously in the same process, no worker needed.

### Production

1. Ensure `REDIS_URL` is set.
2. Start the worker:
   ```bash
   celery -A realestate_backend worker --loglevel=info
   ```
3. Start the beat scheduler (for periodic tasks):
   ```bash
   celery -A realestate_backend beat --loglevel=info
   ```

---

## 14. CORS Configuration

The backend allows cross-origin requests from the following origins (configured in `settings.py`):

```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",   # Vite default
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    os.environ.get("FRONTEND_ORIGIN", "https://yourdomain.com"),
]
CORS_ALLOW_CREDENTIALS = True
```

For a custom dev port, add `FRONTEND_ORIGIN=http://localhost:<port>` to `backend/.env`.  
For production, set `FRONTEND_ORIGIN` to your deployed frontend URL.

---

## 15. Pages Using Mock Data

The following pages still import from `frontend/src/services/mock-data.ts` and **have not yet been wired to the real API**. They must be updated before the application is production-ready.

| File | Mock imports used |
|---|---|
| `src/app/pages/Wishlists.tsx` | `mockProperties` |
| `src/app/pages/UserDashboard.tsx` | `mockProperties`, `mockReviews` |
| `src/app/pages/AdminDashboard.tsx` | `mockUsers`, `mockProperties`, `mockReviews` |
| `src/app/pages/HostProfile.tsx` | `mockUsers`, `mockProperties`, `mockReviews` |
| `src/app/pages/HostDashboard.tsx` | `mockProperties`, `mockReviews` |
| `src/app/components/FiltersDialog.tsx` | `mockProperties` |

**Replacement APIs** already available in `api.service.ts`:

- `propertiesAPI.search()` / `propertiesAPI.getFeatured()` → replaces `mockProperties`
- `propertiesAPI.getReviews()` → replaces `mockReviews`
- `dashboardAPI.getMyDashboard()` → replaces dashboard mock data
- `dashboardAPI.getAgentAnalytics()` → replaces host stats mock data

---

## 16. Production Checklist

- [ ] Set `DJANGO_DEBUG=false`
- [ ] Set a strong `DJANGO_SECRET_KEY`
- [ ] Set `FRONTEND_ORIGIN` to the deployed frontend URL
- [ ] Set `ALLOWED_HOSTS` to your domain (replace `["*"]` in `settings.py`)
- [ ] Configure a PostgreSQL database (replace the SQLite `DATABASES` config)
- [ ] Set `REDIS_URL` for Channels and Celery
- [ ] Configure SMTP credentials (`EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`)
- [ ] Set MTN MoMo live credentials
- [ ] Configure production media storage (S3 or equivalent)
- [ ] Run `python manage.py collectstatic`
- [ ] Serve the frontend build (`pnpm build`) from a CDN or static host
- [ ] Use a process manager (e.g. `supervisor`, `systemd`) for Daphne and Celery
- [ ] Enable HTTPS and update `CORS_ALLOWED_ORIGINS` and `WS_BASE_URL` accordingly
- [ ] Set `AllowedHostsOriginValidator` — already enabled automatically when `DEBUG=false` (see `asgi.py`)
- [ ] Wire the 6 pages listed in [Section 15](#15-pages-using-mock-data) to the real API
