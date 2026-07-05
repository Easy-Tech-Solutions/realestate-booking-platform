# HomeKonet — Production Deployment Guide

This guide covers deploying the HomeKonet real-estate booking platform on a Linux server. Two deployment paths are documented:

- **Path A — Docker Compose** (self-hosted Linux VPS, full control)
- **Path B — Render / PaaS** (uses the `backend/Procfile`)

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 8 — static bundle served by Nginx |
| Backend API | Django 5 + Daphne (ASGI) |
| WebSocket | Django Channels + Redis |
| Database | PostgreSQL 16 |
| Cache / queue broker | Redis 7 |
| Background tasks | Celery worker |
| Scheduled tasks | Celery beat (booking expiry, etc.) |
| Media storage | Cloudinary (production) |
| Email | Brevo (Sendinblue) via `django-anymail` |
| Reverse proxy / TLS | Nginx |
| Container runtime (Path A) | Docker + Docker Compose v2 |
| PaaS runtime (Path B) | Render / Heroku-compatible Procfile |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Server Setup](#2-server-setup)
3. [Install Docker and Docker Compose](#3-install-docker-and-docker-compose)
4. [Project Structure on the Server](#4-project-structure-on-the-server)
5. [Environment Files](#5-environment-files)
6. [Frontend Build Requirements](#6-frontend-build-requirements)
7. [Dockerfiles](#7-dockerfiles)
8. [Docker Compose](#8-docker-compose)
9. [Nginx Configuration](#9-nginx-configuration)
10. [TLS / HTTPS with Let's Encrypt](#10-tls--https-with-lets-encrypt)
11. [Build and Deploy (Docker)](#11-build-and-deploy-docker)
12. [Pre-Deployment Validation](#12-pre-deployment-validation)
13. [Running Migrations and Creating a Superuser](#13-running-migrations-and-creating-a-superuser)
14. [Application Logs](#14-application-logs)
15. [Updating the Application](#15-updating-the-application)
16. [Monitoring and Logs](#16-monitoring-and-logs)
17. [Backup and Restore](#17-backup-and-restore)
18. [Render / PaaS Deployment](#18-render--paas-deployment)
19. [Security Hardening Checklist](#19-security-hardening-checklist)
20. [Quick Reference](#20-quick-reference)

---

## 1. Prerequisites

### Minimum server spec
- Ubuntu 22.04 LTS, **2 GB RAM / 2 vCPUs / 20 GB disk** (4 GB RAM recommended)
- A domain name (e.g. `homekonet.com`) with DNS A records pointing to the server's public IP
- SSH access as a non-root user with `sudo` privileges

### Accounts and API keys to obtain before deploying

| Service | Purpose | Where to get it |
|---|---|---|
| PostgreSQL credentials | Database | Neon, Supabase, or self-hosted |
| Cloudinary | Persistent media storage | cloudinary.com |
| Brevo (Sendinblue) | Transactional email | brevo.com → Settings → API Keys |
| Stripe secret key + webhook secret | Card payments | dashboard.stripe.com |
| Stripe publishable key | Frontend card form | dashboard.stripe.com |
| Google OAuth client ID | Social login | Google Cloud Console |
| MTN MoMo API credentials | Mobile money | MTN developer portal |
| VAPID key pair | Web push notifications | Generate locally (see §5) |

> **Important:** The application uses **Brevo (Sendinblue)** as its production email backend, not Gmail SMTP. All transactional emails (booking confirmations, password resets, account verification) will fail silently if `BREVO_API_KEY` is not set.

---

## 2. Server Setup

```bash
# Update the system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y git curl ufw fail2ban unattended-upgrades

# Configure the firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status

# Enable automatic security updates
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Harden SSH (disable password login — ensure your SSH key is working first)
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Create a dedicated app user
sudo adduser homekonet
sudo usermod -aG sudo homekonet
sudo usermod -aG docker homekonet   # add after Docker is installed
```

---

## 3. Install Docker and Docker Compose

```bash
# Add Docker's official GPG key and repository
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify
docker --version
docker compose version

# Allow the current user to run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker
```

---

## 4. Project Structure on the Server

```bash
# Switch to the app user
su - homekonet

# Clone the repository
git clone https://github.com/Easy-Tech-Solutions/realestate-booking-platform.git /home/homekonet/app
cd /home/homekonet/app
```

Expected layout after cloning:

```
/home/homekonet/app/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── Procfile              # Render/PaaS deployment
│   ├── scripts/
│   │   └── prelaunch_check.py
│   ├── realestate_backend/
│   │   ├── settings.py
│   │   ├── asgi.py
│   │   └── celery.py
│   └── ...
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── ...
├── nginx/
│   ├── nginx.conf            # created in §9
│   └── ssl/                  # TLS certs placed here
├── docker-compose.yml        # created in §8
├── Dockerfile.backend        # created in §7
├── Dockerfile.frontend       # created in §7
└── docs/
```

---

## 5. Environment Files

**Never commit secrets.** Create environment files on the server only. The repository contains `backend/.env.example` and `frontend/.env.example` as templates.

### Generating required secrets

```bash
# Django SECRET_KEY (run on the server or locally)
python -c "import secrets; print(secrets.token_urlsafe(50))"

# VAPID key pair for web push notifications
pip install py-vapid
python -c "
from py_vapid import Vapid
v = Vapid()
v.generate_keys()
print('VAPID_PRIVATE_KEY=' + v.private_key.decode())
print('VAPID_PUBLIC_KEY='  + v.public_key.decode())
"
```

### `backend/.env` (production)

```ini
# ── Django core ────────────────────────────────────────────────────────────────
DJANGO_SECRET_KEY=<output of token_urlsafe(50) above>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=homekonet.com,www.homekonet.com
FRONTEND_ORIGIN=https://homekonet.com
CORS_ALLOWED_ORIGINS=https://homekonet.com

# Django admin URL — change from the default to obscure it
DJANGO_ADMIN_URL=secure-admin-path/

# Auth
AUTH_REQUIRE_EMAIL_VERIFICATION=true
AUTH_REFRESH_COOKIE_DOMAIN=.homekonet.com
AUTH_REFRESH_COOKIE_SAMESITE=Lax

# CSRF
CSRF_TRUSTED_ORIGINS=https://homekonet.com,https://www.homekonet.com

# ── Database ───────────────────────────────────────────────────────────────────
# Use DATABASE_URL for Neon/managed postgres (overrides individual POSTGRES_* vars)
# DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
DB_ENGINE=postgres
POSTGRES_DB=homekonet_prod
POSTGRES_USER=homekonet
POSTGRES_PASSWORD=<strong_password>
POSTGRES_HOST=db            # 'db' = Docker Compose service name; use Neon host for managed DB
POSTGRES_PORT=5432
POSTGRES_CONN_MAX_AGE=60

# ── Email (Brevo / Sendinblue) ─────────────────────────────────────────────────
# Production email backend — requires BREVO_API_KEY.
# Without this key ALL transactional emails fail silently.
EMAIL_BACKEND=anymail.backends.sendinblue.EmailBackend
BREVO_API_KEY=<your_brevo_api_key>
DEFAULT_FROM_EMAIL=HomeKonet <noreply@homekonet.com>

# ── Domain ─────────────────────────────────────────────────────────────────────
LOCAL_DOMAIN=homekonet.com
SITE_NAME=HomeKonet

# ── Google OAuth ───────────────────────────────────────────────────────────────
GOOGLE_OAUTH_CLIENT_ID=<client_id>.apps.googleusercontent.com

# ── Stripe ────────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── MTN Mobile Money ──────────────────────────────────────────────────────────
MTN_MOMO_API_KEY=<key>
MTN_MOMO_USER_ID=<user_id>
MTN_MOMO_API_SECRET=<secret>
MTN_BUSINESS_NUMBER=<number>

# ── Orange Money (optional) ───────────────────────────────────────────────────
ORANGE_MONEY_API_KEY=
ORANGE_MONEY_API_SECRET=

# ── Redis ──────────────────────────────────────────────────────────────────────
# Docker Compose: 'redis' is the service name.
# Render: use the internal Redis connection string from your Redis service.
REDIS_URL=redis://redis:6379/0

# ── Celery ─────────────────────────────────────────────────────────────────────
CELERY_ALWAYS_EAGER=false

# ── Security ───────────────────────────────────────────────────────────────────
SECURE_SSL_REDIRECT=true
SECURE_HSTS_SECONDS=31536000

# ── Cloudinary (required for persistent media in production) ──────────────────
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>

# ── Web Push Notifications (VAPID) ────────────────────────────────────────────
# Generate with: pip install py-vapid && python -c "from py_vapid import Vapid; ..."
VAPID_PRIVATE_KEY=<generated_private_key>
VAPID_PUBLIC_KEY=<generated_public_key>
```

> **Using Neon or another managed database?** Uncomment `DATABASE_URL` and remove the individual `POSTGRES_*` variables. Remove the `db` service from `docker-compose.yml`.

---

## 6. Frontend Build Requirements

> **Critical:** Vite bakes environment variables into the JavaScript bundle **at build time**, not at runtime. Setting `VITE_*` variables on the server after the build has no effect. You must set them in your CI/CD environment or before running `npm run build`.

### Required build-time variables

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | **Required.** Full URL of the backend API. Without this, the build hardcodes `http://localhost:8000` and every API call fails in production. | `https://homekonet.com` |
| `VITE_WS_URL` | WebSocket URL. Optional — derived from `window.location` if omitted. | `wss://homekonet.com` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for the card payment form. | `pk_live_...` |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID for social login. | `123...apps.googleusercontent.com` |

### `frontend/.env` (production — used at build time)

```ini
VITE_API_URL=https://homekonet.com
VITE_WS_URL=wss://homekonet.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_GOOGLE_OAUTH_CLIENT_ID=<client_id>.apps.googleusercontent.com
```

### Building the frontend manually

```bash
cd frontend

# Copy the production env file so Vite can read it
cp .env.production .env   # or set the vars in your shell

npm install
npm run build             # outputs to frontend/dist/
```

---

## 7. Dockerfiles

### `Dockerfile.backend`

Place this at the repository root. The `collectstatic` and `migrate` steps run at **container startup** via the entrypoint script, not at image build time, so no secrets need to be present during `docker build`.

```dockerfile
# ── Stage 1: build dependencies ──────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libjpeg-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --upgrade pip && \
    pip install --prefix=/install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libjpeg62-turbo curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY backend/ .

# Startup script: migrate → collectstatic → start Daphne
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "realestate_backend.asgi:application"]
```

### `docker-entrypoint.sh`

Place this at the repository root alongside the Dockerfiles.

```bash
#!/bin/sh
set -e

echo "==> Applying database migrations..."
python manage.py migrate --no-input

echo "==> Collecting static files..."
python manage.py collectstatic --no-input

echo "==> Starting: $*"
exec "$@"
```

### `Dockerfile.frontend`

```dockerfile
# ── Stage 1: build the React app ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package.json ./
RUN npm install --ignore-scripts

COPY frontend/ .

# .env must be present at build time with VITE_* variables set.
# Either copy it here or pass variables as Docker build args.
# Example: docker compose build --build-arg VITE_API_URL=https://homekonet.com
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_GOOGLE_OAUTH_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_GOOGLE_OAUTH_CLIENT_ID=$VITE_GOOGLE_OAUTH_CLIENT_ID

RUN npm run build

# ── Stage 2: serve with Nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## 8. Docker Compose

Create `docker-compose.yml` at the repository root.

```yaml
version: "3.9"

services:

  # ── PostgreSQL ────────────────────────────────────────────────────────────
  # Remove this service if using an external managed database (Neon, Supabase).
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Redis ─────────────────────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Django / Daphne backend ───────────────────────────────────────────────
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    restart: unless-stopped
    env_file:
      - backend/.env
    depends_on:
      redis:
        condition: service_healthy
      db:
        condition: service_healthy
    volumes:
      - backend_logs:/app/logs
    expose:
      - "8000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8000/api/health/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ── Celery worker ─────────────────────────────────────────────────────────
  celery:
    build:
      context: .
      dockerfile: Dockerfile.backend
    restart: unless-stopped
    command: celery -A realestate_backend worker --loglevel=info --concurrency=2
    env_file:
      - backend/.env
    depends_on:
      redis:
        condition: service_healthy
      backend:
        condition: service_started
    volumes:
      - backend_logs:/app/logs

  # ── Celery beat (scheduled tasks) ─────────────────────────────────────────
  # Required for periodic tasks: expire unconfirmed reservations, expire unpaid
  # bookings, etc. Without this service, those tasks never run.
  celery-beat:
    build:
      context: .
      dockerfile: Dockerfile.backend
    restart: unless-stopped
    command: celery -A realestate_backend beat --loglevel=info
    env_file:
      - backend/.env
    depends_on:
      redis:
        condition: service_healthy
      backend:
        condition: service_started
    volumes:
      - backend_logs:/app/logs

  # ── React frontend (Nginx) ────────────────────────────────────────────────
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        VITE_API_URL: https://homekonet.com
        VITE_WS_URL: wss://homekonet.com
        VITE_STRIPE_PUBLISHABLE_KEY: ${VITE_STRIPE_PUBLISHABLE_KEY}
        VITE_GOOGLE_OAUTH_CLIENT_ID: ${VITE_GOOGLE_OAUTH_CLIENT_ID}
    restart: unless-stopped
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  backend_logs:
```

> **Using Neon or managed database?** Remove the `db` service and the `db` dependency under `backend`. Set `POSTGRES_HOST` in `backend/.env` to your Neon host and enable SSL: `POSTGRES_SSLMODE=require`.

> **Cloudinary and local media:** When `CLOUDINARY_URL` is set, all uploads go directly to Cloudinary and there is no local media directory. The Nginx `/media/` block and the Django `serve()` fallback are both automatically bypassed. No `media_files` Docker volume is needed.

---

## 9. Nginx Configuration

Create `nginx/nginx.conf`. Replace `homekonet.com` with your actual domain.

```nginx
# Redirect all HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name homekonet.com www.homekonet.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name homekonet.com www.homekonet.com;

    # TLS certificates (generated in §10)
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling        on;
    ssl_stapling_verify on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    client_max_body_size 20M;

    # ── Django static files ───────────────────────────────────────────────
    location /static/ {
        alias /usr/share/nginx/html/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ── Local media files (only needed when Cloudinary is NOT configured) ─
    # When CLOUDINARY_URL is set in backend/.env, Django never writes to the
    # local filesystem and this block is unused. Remove it if using Cloudinary.
    # location /media/ {
    #     alias /app/media/;
    #     expires 7d;
    # }

    # ── WebSocket connections ─────────────────────────────────────────────
    location /ws/ {
        proxy_pass         http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "Upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }

    # ── Django REST API ───────────────────────────────────────────────────
    location /api/ {
        proxy_pass         http://backend:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }

    # ── Django admin (path matches DJANGO_ADMIN_URL in .env) ─────────────
    # Update this path to match whatever you set in DJANGO_ADMIN_URL.
    location /secure-admin-path/ {
        proxy_pass         http://backend:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # ── React SPA (catch-all) ─────────────────────────────────────────────
    location / {
        root  /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 10. TLS / HTTPS with Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot

# Obtain certificates (standalone mode — ensure ports 80/443 are free first)
sudo certbot certonly --standalone \
  -d homekonet.com -d www.homekonet.com \
  --email admin@homekonet.com \
  --agree-tos --non-interactive

# Copy certs to the nginx ssl directory
sudo mkdir -p /home/homekonet/app/nginx/ssl
sudo cp /etc/letsencrypt/live/homekonet.com/fullchain.pem /home/homekonet/app/nginx/ssl/
sudo cp /etc/letsencrypt/live/homekonet.com/privkey.pem   /home/homekonet/app/nginx/ssl/
sudo chown -R homekonet:homekonet /home/homekonet/app/nginx/ssl
sudo chmod 600 /home/homekonet/app/nginx/ssl/privkey.pem

# Auto-renew certs (add to crontab)
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/homekonet.com/fullchain.pem /home/homekonet/app/nginx/ssl/ && \
  cp /etc/letsencrypt/live/homekonet.com/privkey.pem   /home/homekonet/app/nginx/ssl/ && \
  docker compose -f /home/homekonet/app/docker-compose.yml exec frontend nginx -s reload") | crontab -
```

---

## 11. Build and Deploy (Docker)

```bash
cd /home/homekonet/app

# Build all images (pass Vite build args for the frontend)
docker compose build --no-cache \
  --build-arg VITE_API_URL=https://homekonet.com \
  --build-arg VITE_WS_URL=wss://homekonet.com \
  --build-arg VITE_STRIPE_PUBLISHABLE_KEY=pk_live_... \
  --build-arg VITE_GOOGLE_OAUTH_CLIENT_ID=<client_id>.apps.googleusercontent.com

# Start everything in the background
docker compose up -d

# Verify all containers are running and healthy
docker compose ps
```

Expected output:
```
NAME                    STATUS           PORTS
app-backend-1           Up (healthy)     8000/tcp
app-celery-1            Up
app-celery-beat-1       Up
app-db-1                Up (healthy)     5432/tcp
app-frontend-1          Up               0.0.0.0:80->80, 0.0.0.0:443->443
app-redis-1             Up (healthy)     6379/tcp
```

---

## 12. Pre-Deployment Validation

Run the built-in pre-launch check before going live. It validates all critical settings.

```bash
# Docker Compose
docker compose exec backend python scripts/prelaunch_check.py

# Or directly on the server (with the virtual environment active)
cd backend
python scripts/prelaunch_check.py
```

The check validates:
- `DJANGO_DEBUG=false`
- `SECRET_KEY` is non-default and ≥32 characters
- `ALLOWED_HOSTS` does not contain `*`
- Database is PostgreSQL (not SQLite)
- `AUTH_REQUIRE_EMAIL_VERIFICATION=true`
- `REDIS_URL` is set
- `CLOUDINARY_URL` is set
- Email backend is configured for production

All items must show **PASS** before going live. Pass `--allow-dev` to treat failures as warnings during staging.

```bash
python scripts/prelaunch_check.py --allow-dev   # staging / review environment
python scripts/prelaunch_check.py               # production (strict)
```

---

## 13. Running Migrations and Creating a Superuser

The Docker entrypoint runs `migrate` automatically on each container start. Run these commands once after the first deployment:

```bash
# Create the Django admin superuser
docker compose exec backend python manage.py createsuperuser

# Verify migrations applied cleanly
docker compose exec backend python manage.py showmigrations | grep '\[ \]'
# Should return nothing (all applied)
```

The Django admin panel is at the path you set in `DJANGO_ADMIN_URL`:
```
https://homekonet.com/secure-admin-path/
```

### Stripe webhook registration

After deployment, register the webhook endpoint in the Stripe Dashboard:

1. Go to **Developers → Webhooks → Add endpoint**
2. URL: `https://homekonet.com/api/payments/stripe/webhook/`
3. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in your `.env`

---

## 14. Application Logs

The backend writes four structured JSON log files to `backend/logs/` (rotated at 10 MB × 10 backups each):

| File | Contents |
|---|---|
| `application.log` | All HTTP requests (method, path, status, duration, user) |
| `activity.log` | User actions: register, login, logout, booking created/confirmed/declined, account deletion |
| `transactions.log` | Payment events: initiated, verified, failed, refunded |
| `errors.log` | `WARNING` and above from all loggers |

In Docker, logs are written to the `backend_logs` named volume. To tail them:

```bash
# Enter the backend container
docker compose exec backend bash

# Tail activity log
tail -f logs/activity.log | python -m json.tool

# Or mount the volume to the host for log aggregation
docker run --rm -v app_backend_logs:/logs alpine ls -la /logs
```

For production, consider shipping these logs to a log aggregator (Datadog, Loki, Papertrail) using a sidecar container or Docker log driver.

---

## 15. Updating the Application

```bash
cd /home/homekonet/app

# Pull latest code
git pull origin main

# Rebuild only changed images (Docker cache handles unchanged layers)
# Pass Vite build args again — they are baked into the image
docker compose build \
  --build-arg VITE_API_URL=https://homekonet.com \
  --build-arg VITE_WS_URL=wss://homekonet.com \
  --build-arg VITE_STRIPE_PUBLISHABLE_KEY=pk_live_... \
  --build-arg VITE_GOOGLE_OAUTH_CLIENT_ID=<client_id>.apps.googleusercontent.com

# Rolling restart
docker compose up -d --force-recreate

# Confirm everything is healthy
docker compose ps
docker compose logs --tail=50 backend
```

To update a single service:

```bash
docker compose build backend
docker compose up -d --no-deps --force-recreate backend
```

---

## 16. Monitoring and Logs

```bash
# Live logs for all services
docker compose logs -f

# Logs for a specific service
docker compose logs -f backend
docker compose logs -f celery
docker compose logs -f celery-beat

# Resource usage
docker stats

# Enter a container
docker compose exec backend bash
docker compose exec celery bash
```

### Docker log rotation

Configure in `/etc/docker/daemon.json` to prevent disk fill:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

```bash
sudo systemctl restart docker
```

### Health monitoring

At minimum, set up an uptime check on your domain (UptimeRobot free tier covers this). For full observability:
- **Error aggregation:** Sentry (`pip install sentry-sdk[django]` — not yet configured)
- **Metrics:** Prometheus + Grafana
- **Log aggregation:** Loki + Promtail or Papertrail

---

## 17. Backup and Restore

### Back up the PostgreSQL database

```bash
# Create backup directory
mkdir -p /home/homekonet/backups

# Dump
docker compose exec -T db pg_dump -U $POSTGRES_USER $POSTGRES_DB \
  | gzip > /home/homekonet/backups/db_$(date +%Y%m%d_%H%M%S).sql.gz

# Schedule daily backups at 02:00
(crontab -l 2>/dev/null; echo "0 2 * * * docker compose -f /home/homekonet/app/docker-compose.yml \
  exec -T db pg_dump -U \$POSTGRES_USER \$POSTGRES_DB | gzip > \
  /home/homekonet/backups/db_\$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz") | crontab -

# Keep only the last 30 days of backups
(crontab -l 2>/dev/null; echo "30 2 * * * find /home/homekonet/backups -name 'db_*.sql.gz' -mtime +30 -delete") | crontab -
```

> **Using Neon?** Use Neon's built-in branching and point-in-time restore instead of manual dumps.

### Restore from a backup

```bash
gunzip -c /home/homekonet/backups/db_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB
```

### Media files

When `CLOUDINARY_URL` is configured (recommended), all uploads are stored in Cloudinary — no local backup needed. If running without Cloudinary:

```bash
docker run --rm \
  -v app_backend_logs:/logs \
  -v /home/homekonet/backups:/backup \
  alpine tar czf /backup/logs_$(date +%Y%m%d).tar.gz /logs
```

---

## 18. Render / PaaS Deployment

The repository includes `backend/Procfile` for Render, Railway, Heroku, and compatible platforms.

### `backend/Procfile`

```
web:    python manage.py migrate --no-input && python manage.py collectstatic --no-input && daphne -b 0.0.0.0 -p $PORT realestate_backend.asgi:application
worker: celery -A realestate_backend worker -l info
beat:   celery -A realestate_backend beat -l info
```

### Render setup

1. **Backend web service**
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: *(from Procfile `web` line)*
   - Set all environment variables from §5 in the Render dashboard

2. **Celery worker service** (separate Render Background Worker)
   - Root directory: `backend`
   - Start command: `celery -A realestate_backend worker -l info`
   - Same environment variables as the web service

3. **Celery beat service** (separate Render Background Worker — **required for booking expiry**)
   - Root directory: `backend`
   - Start command: `celery -A realestate_backend beat -l info`
   - Same environment variables as the web service

4. **Redis** — Use Render's managed Redis service. Copy the internal `REDIS_URL` to all three services.

5. **Frontend** (separate Render Static Site)
   - Root directory: `frontend`
   - Build command: `npm install && npm run build`
   - Publish directory: `dist`
   - **Set `VITE_API_URL` to your backend web service URL** in the Static Site's environment variables — this is baked in at build time

> **Note on free-tier Render:** Background Workers (celery, beat) require a paid plan. On the free tier, scheduled tasks and async email will not run.

---

## 19. Security Hardening Checklist

Before going live, verify **all** of the following:

### Server

- [ ] SSH password login disabled; key-based authentication only
- [ ] UFW firewall active — only ports 22, 80, 443 open
- [ ] Fail2ban installed and active (`systemctl status fail2ban`)
- [ ] Non-root user running the application
- [ ] Automatic security updates enabled (`unattended-upgrades`)

### Django

- [ ] `DJANGO_DEBUG=false` in production `.env`
- [ ] `DJANGO_SECRET_KEY` is a long random string (≥50 chars), not the placeholder
- [ ] `DJANGO_ALLOWED_HOSTS` contains only your production domain(s)
- [ ] `DJANGO_ADMIN_URL` is changed from the default `admin/` to an obscure path
- [ ] `SECURE_SSL_REDIRECT=true`
- [ ] `SECURE_HSTS_SECONDS=31536000`
- [ ] `AUTH_REQUIRE_EMAIL_VERIFICATION=true`
- [ ] Pre-launch check passes: `python scripts/prelaunch_check.py`

### Email

- [ ] `BREVO_API_KEY` is set — send a test email with `python manage.py sendtestemail your@email.com`
- [ ] `DEFAULT_FROM_EMAIL` is a verified sender address in Brevo

### Payments

- [ ] `STRIPE_SECRET_KEY` is a **live** key (starts with `sk_live_`), not a test key
- [ ] `STRIPE_WEBHOOK_SECRET` is set and matches the webhook registered in the Stripe Dashboard
- [ ] Stripe webhook endpoint is registered: `https://yourdomain.com/api/payments/stripe/webhook/`
- [ ] MTN MoMo credentials are production credentials

### Database

- [ ] Database is PostgreSQL, not SQLite
- [ ] Database is not exposed on a public port (Docker internal only)
- [ ] Strong, unique password for the database user
- [ ] SSL enabled for the database connection if using managed Postgres

### Secrets and API Keys

- [ ] `backend/.env` is **not** in git (`git status` shows it as untracked)
- [ ] All API keys are production keys (not test/dev)
- [ ] `CLOUDINARY_URL` is set — verify by uploading a test image
- [ ] `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY` are set (required for web push notifications)

### TLS

- [ ] HTTPS enforced; HTTP redirects to HTTPS
- [ ] Certificate auto-renewal cron job is active (`crontab -l`)
- [ ] TLSv1.2 and TLSv1.3 only (test with `ssl-checker.internet.nl` or `testssl.sh`)

### Frontend

- [ ] `VITE_API_URL` was set **at build time** to the production backend URL
- [ ] No `localhost` references appear in the production JS bundle: `grep -r 'localhost' frontend/dist/`
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` is a live key (starts with `pk_live_`)

### Docker

- [ ] Docker log rotation configured in `/etc/docker/daemon.json`
- [ ] Sensitive env files have `chmod 600`
- [ ] All containers running and healthy: `docker compose ps`

### Monitoring

- [ ] Uptime monitoring active (UptimeRobot or similar)
- [ ] `docker compose logs` reviewed for errors after each deployment
- [ ] Application logs in `backend/logs/` are being written and rotated

---

## 20. Quick Reference

| Task | Docker Compose | Render / Procfile |
|---|---|---|
| Start all services | `docker compose up -d` | Deploy via dashboard |
| Stop all services | `docker compose down` | — |
| Rebuild and restart | `docker compose build && docker compose up -d --force-recreate` | Redeploy |
| Run migrations | `docker compose exec backend python manage.py migrate` | Runs on startup |
| Open Django shell | `docker compose exec backend python manage.py shell` | `heroku run python manage.py shell` |
| Tail all logs | `docker compose logs -f` | Render log stream |
| Check container health | `docker compose ps` | Render dashboard |
| Restart one service | `docker compose restart backend` | Manual deploy |
| Pre-launch check | `docker compose exec backend python scripts/prelaunch_check.py` | `python scripts/prelaunch_check.py` |
| Enter a container | `docker compose exec backend bash` | — |
| Remove all volumes ⚠️ | `docker compose down -v` | — |
