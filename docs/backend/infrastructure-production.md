# Backend Production Infrastructure (Linux)

This guide covers production setup for the Django backend on Linux, including PostgreSQL, Redis, SMTP email, and external payment APIs.

## 1. Target Architecture

- OS: Ubuntu 22.04+ (or equivalent Linux distro)
- App server: Daphne (ASGI)
- Reverse proxy: Nginx
- Process manager: systemd
- Database: PostgreSQL
- Cache / broker: Redis
- Background jobs: Celery worker + Celery beat
- TLS: Let's Encrypt (Certbot)

## 2. System Packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx redis-server postgresql postgresql-contrib
```

Optional utilities:

```bash
sudo apt install -y ufw jq curl
```

## 3. Application User and Directories

```bash
sudo adduser --system --group --home /srv/realestate realestate
sudo mkdir -p /srv/realestate/app
sudo chown -R realestate:realestate /srv/realestate
```

Deploy code to /srv/realestate/app and set ownership to the realestate user.

## 4. Python Environment and Dependencies

```bash
cd /srv/realestate/app/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 5. PostgreSQL Setup

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE realestate_prod;
CREATE USER realestate_user WITH ENCRYPTED PASSWORD 'replace-with-strong-password';
ALTER ROLE realestate_user SET client_encoding TO 'utf8';
ALTER ROLE realestate_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE realestate_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE realestate_prod TO realestate_user;
\q
```

## 6. Redis Setup

- Confirm Redis is active:

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server
sudo systemctl status redis-server
```

- If Redis is remote, enforce private networking and auth.

## 7. Backend Environment File

Create backend/.env from backend/.env.production.example and fill all values:

Required high-priority keys:

- DJANGO_SECRET_KEY
- DJANGO_DEBUG=false
- DJANGO_ALLOWED_HOSTS
- FRONTEND_ORIGIN
- CORS_ALLOWED_ORIGINS
- DB_ENGINE=postgres
- POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT
- REDIS_URL
- EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
- EMAIL_HOST_USER / EMAIL_HOST_PASSWORD / DEFAULT_FROM_EMAIL
- AUTH_REQUIRE_EMAIL_VERIFICATION=true
- CELERY_ALWAYS_EAGER=false
- MTN_MOMO_API_KEY / MTN_MOMO_USER_ID / MTN_MOMO_API_SECRET / MTN_BUSINESS_NUMBER

## 8. Django Migrations and Static

```bash
cd /srv/realestate/app/backend
source .venv/bin/activate
python manage.py migrate
python manage.py collectstatic --noinput
```

If Redis cache is not used, also run:

```bash
python manage.py createcachetable
```

## 9. Payment Gateway Records

The MTN gateway model row must exist in the production DB.

Use Django admin or shell to ensure an active PaymentGateway row exists for name=mtn_momo with credentials populated.

## 10. systemd Services

Create these services:

- realestate-daphne.service
- realestate-celery-worker.service
- realestate-celery-beat.service

Example Daphne service:

```ini
[Unit]
Description=RealEstate Daphne
After=network.target

[Service]
User=realestate
Group=realestate
WorkingDirectory=/srv/realestate/app/backend
EnvironmentFile=/srv/realestate/app/backend/.env
ExecStart=/srv/realestate/app/backend/.venv/bin/daphne -b 127.0.0.1 -p 8000 realestate_backend.asgi:application
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Example Celery worker service:

```ini
[Unit]
Description=RealEstate Celery Worker
After=network.target redis-server.service

[Service]
User=realestate
Group=realestate
WorkingDirectory=/srv/realestate/app/backend
EnvironmentFile=/srv/realestate/app/backend/.env
ExecStart=/srv/realestate/app/backend/.venv/bin/celery -A realestate_backend worker --loglevel=info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Example Celery beat service:

```ini
[Unit]
Description=RealEstate Celery Beat
After=network.target redis-server.service

[Service]
User=realestate
Group=realestate
WorkingDirectory=/srv/realestate/app/backend
EnvironmentFile=/srv/realestate/app/backend/.env
ExecStart=/srv/realestate/app/backend/.venv/bin/celery -A realestate_backend beat --loglevel=info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable realestate-daphne realestate-celery-worker realestate-celery-beat
sudo systemctl restart realestate-daphne realestate-celery-worker realestate-celery-beat
```

## 11. Nginx Reverse Proxy and TLS

Example Nginx site:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /srv/realestate/app/backend/static/;
    }

    location /media/ {
        alias /srv/realestate/app/backend/media/;
    }
}
```

Then issue TLS certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

## 12. Email Provider Validation

Before go-live, confirm:

- SPF, DKIM, and DMARC are configured for your sender domain
- registration verification emails send successfully
- password reset emails send successfully
- notification emails send successfully from Celery tasks

## 13. External API Validation (MTN / others)

Before go-live, confirm:

- live MTN credentials are set and sandbox mode is disabled in gateway config
- webhook callback URL is publicly reachable
- webhook signatures validate correctly
- successful payment updates booking state
- owner payout/disbursement path succeeds or fails safely with alerting

## 14. Pre-Launch Command

Run from repository root:

```bash
bash scripts/release-check.sh
```

If this command fails, do not deploy until all FAIL checks are resolved.
