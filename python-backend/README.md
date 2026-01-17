# Django Backend (python-backend)

This is a minimal Django + DRF backend scaffold to connect with the React app in `react-frontend`.

## Quick Start (Windows)

```bash
cd "python-backend"
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set -a && copy .env.example .env
python manage.py migrate
python manage.py runserver 8000
```

React dev server should call the API at `http://localhost:8000`.

## API Routes

- Auth
  - POST `/api/auth/login`
  - POST `/api/auth/register`
  - GET  `/api/auth/me`
- Listings
  - GET  `/api/listings`
  - POST `/api/listings`
  - GET  `/api/listings/<id>`
- Bookings
  - GET  `/api/bookings`
  - POST `/api/bookings`
  - GET  `/api/bookings/<id>`
- Users
  - GET  `/api/users`
  - GET  `/api/users/<id>`

## Environment

- Default DB: SQLite (`db.sqlite3`)
- CORS: allows `http://localhost:5173` (Vite dev server)

You can adjust settings in `realestate_backend/settings.py`. Copy `.env.example` to `.env` to override defaults.
