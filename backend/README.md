# Real Estate Booking Platform Backend

API-first backend built with Django and Django REST Framework.

Key features: custom user with roles, JWT auth, 2FA hooks, SSO hooks, properties, bookings, payments (card + MOMO ready), notifications, analytics. Modular apps with services and production-oriented settings.

## Quickstart (Local)

1. Create and activate a virtualenv
```
python -m venv .venv
.venv\\Scripts\\activate
```

2. Install dependencies
```
pip install -r requirements/dev.txt
```

3. Configure environment
```
cp .env.example .env
```
Edit `.env` as needed.

4. Run migrations and start server
```
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

API root: http://127.0.0.1:8000/api/v1/

## Docker (Postgres + Redis)

```
docker compose up --build
```

Web service listens on 8000, Postgres on 5432, Redis on 6379.

## Tech Notes

- Settings split: `settings/base.py`, `settings/local.py`, `settings/production.py`
- Celery configured via `realestate_platform/celery.py`
- Custom user model: `apps.accounts.User` (set via `AUTH_USER_MODEL`)
- JWT auth via SimpleJWT
- CORS via `django-cors-headers`
- Throttling and headers in `realestate_platform/security/*`
