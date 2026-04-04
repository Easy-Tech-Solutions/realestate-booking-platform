# Testing Guide

This guide explains how to run tests for both backend and frontend in this repository.

## 1) Testing Folder Structure

- `testing/backend/` : Place backend-specific test plans, fixtures, and reports.
- `testing/frontend/` : Place frontend-specific test plans, fixtures, and reports.

## 2) Backend Testing (Django)

### Prerequisites

1. Python virtual environment is created and activated.
2. Dependencies are installed from `backend/requirements.txt`.
3. Database migrations are applied.

### Setup

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
```

### Run all Django tests

```bash
cd backend
python manage.py test
```

### Run specific test files already present in backend

```bash
cd backend
python test_booking.py
python test_booking_django.py
python test_permissions.py
python test_permissions_proper.py
```

### Optional: Verbose test output

```bash
cd backend
python manage.py test -v 2
```

## 3) Frontend Testing (React/Vite)

The current frontend package scripts include `dev` and `build`. If no test script exists yet, add one before running automated frontend tests.

### Install dependencies

```bash
cd frontend
pnpm install
```

### Current validation command

Use build as a baseline validation step:

```bash
cd frontend
pnpm build
```

### If adding a unit test runner (recommended)

If you choose Vitest later, typical scripts are:

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest run --coverage"
  }
}
```

Then run:

```bash
cd frontend
pnpm test
```

## 4) Integration Testing Flow (Recommended Order)

1. Run backend tests first (`python manage.py test`).
2. Run frontend validation (`pnpm build`) and frontend tests if configured.
3. Start backend and frontend locally.
4. Validate integration-critical flows manually:
   - Authentication: login, refresh token, logout.
   - Listings: list/search/detail/favorite.
   - Bookings: create/confirm/decline/cancel.
   - Messaging: start conversation, send message.
   - Notifications: read one, read all.
   - Payments: initiate and status check.

## 5) Useful Troubleshooting

### Backend

- Migration issues:

```bash
cd backend
python manage.py showmigrations
python manage.py migrate
```

- Missing environment variables: confirm values in `backend/.env`.

### Frontend

- API calls failing: verify `VITE_API_URL` in `frontend/.env`.
- WebSocket failing: verify `VITE_WS_URL` and backend ASGI server status.

## 6) CI Recommendation

For CI, run at least:

```bash
# Backend
cd backend && python manage.py test

# Frontend
cd frontend && pnpm install && pnpm build
```

Add frontend unit tests to CI after test scripts are configured.
