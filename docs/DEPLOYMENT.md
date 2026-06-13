# HomeKonet — Production Deployment Guide

This guide covers deploying the HomeKonet real-estate booking platform on a Linux server using Docker and Docker Compose. The stack is:

| Layer | Technology |
|---|---|
| Frontend | React (Vite) — built to static files, served by Nginx |
| Backend API | Django + Daphne (ASGI) |
| WebSocket | Django Channels + Redis |
| Database | PostgreSQL |
| Cache / queue broker | Redis |
| Background tasks | Celery worker |
| Reverse proxy / TLS | Nginx |
| Container runtime | Docker + Docker Compose v2 |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Server Setup](#2-server-setup)
3. [Install Docker and Docker Compose](#3-install-docker-and-docker-compose)
4. [Project Structure on the Server](#4-project-structure-on-the-server)
5. [Environment Files](#5-environment-files)
6. [Dockerfiles](#6-dockerfiles)
7. [Docker Compose (docker-compose.yml)](#7-docker-compose-file)
8. [Nginx Configuration](#8-nginx-configuration)
9. [TLS / HTTPS with Let's Encrypt](#9-tls--https-with-lets-encrypt)
10. [Build and Deploy](#10-build-and-deploy)
11. [Running Migrations and Creating a Superuser](#11-running-migrations-and-creating-a-superuser)
12. [Updating the Application](#12-updating-the-application)
13. [Monitoring and Logs](#13-monitoring-and-logs)
14. [Backup and Restore](#14-backup-and-restore)
15. [Security Hardening Checklist](#15-security-hardening-checklist)

---

## 1. Prerequisites

- A Linux server (Ubuntu 22.04 LTS recommended) with at least **2 GB RAM / 2 vCPUs / 20 GB disk**
- A domain name (e.g. `homekonet.com`) with DNS A records pointing to the server's public IP
- SSH access to the server as a non-root user with `sudo` privileges
- The following accounts / API keys ready:
  - PostgreSQL credentials (or use Neon, Supabase, etc.)
  - Cloudinary (media storage)
  - Stripe (publishable + secret keys + webhook secret)
  - Google OAuth client ID
  - SMTP credentials (e.g. Gmail App Password, SendGrid)
  - MTN MoMo API credentials

---

## 2. Server Setup

```bash
# Update the system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y git curl ufw fail2ban

# Configure the firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status

# Harden SSH (disable password login)
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
git clone https://github.com/your-org/realestate-booking-platform.git /home/homekonet/app
cd /home/homekonet/app
```

Expected layout after cloning:

```
/home/homekonet/app/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── realestate_backend/
│   └── ...
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── ...
├── nginx/
│   ├── nginx.conf          # created in step 8
│   └── ssl/                # TLS certs placed here
├── docker-compose.yml      # created in step 7
├── Dockerfile.backend      # created in step 6
├── Dockerfile.frontend     # created in step 6
└── docs/
```

---

## 5. Environment Files

**Never commit secrets.** Create the env files on the server only.

### `backend/.env.production`

```ini
# Django
DJANGO_SECRET_KEY=<generate with: python -c "import secrets; print(secrets.token_urlsafe(50))">
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=homekonet.com,www.homekonet.com
FRONTEND_ORIGIN=https://homekonet.com
CORS_ALLOWED_ORIGINS=https://homekonet.com

# Auth
AUTH_REQUIRE_EMAIL_VERIFICATION=true

# Database (Neon / managed Postgres)
DB_ENGINE=postgres
POSTGRES_DB=neondb
POSTGRES_USER=<db_user>
POSTGRES_PASSWORD=<db_password>
POSTGRES_HOST=<your-neon-host>.neon.tech
POSTGRES_PORT=5432
POSTGRES_CONN_MAX_AGE=60

# Email
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_HOST_USER=no-reply@homekonet.com
EMAIL_HOST_PASSWORD=<app_password>
DEFAULT_FROM_EMAIL=HomeKonet <no-reply@homekonet.com>

# Domain
LOCAL_DOMAIN=homekonet.com
SITE_NAME=HomeKonet

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=<your_client_id>.apps.googleusercontent.com

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# MTN MoMo
MTN_MOMO_API_KEY=<key>
MTN_MOMO_USER_ID=<user_id>
MTN_MOMO_API_SECRET=<secret>
MTN_BUSINESS_NUMBER=<number>

# Redis (use the internal Docker service name)
REDIS_URL=redis://redis:6379/0

# Celery
CELERY_ALWAYS_EAGER=false

# Security
SECURE_SSL_REDIRECT=true
SECURE_HSTS_SECONDS=31536000

# Cloudinary
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
```

### `frontend/.env.production`

```ini
VITE_API_URL=https://homekonet.com
VITE_WS_URL=wss://homekonet.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_GOOGLE_OAUTH_CLIENT_ID=<your_client_id>.apps.googleusercontent.com
```

---

## 6. Dockerfiles

### `Dockerfile.backend`

Place this at the repository root.

```dockerfile
# ── Stage 1: build dependencies ──────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# System deps needed to compile psycopg2 and Pillow
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

# Runtime libs only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libjpeg62-turbo && \
    rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy source
COPY backend/ .

# Collect static files at build time
RUN python manage.py collectstatic --noinput --settings=realestate_backend.settings

EXPOSE 8000

# Daphne serves both HTTP and WebSocket
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "realestate_backend.asgi:application"]
```

### `Dockerfile.frontend`

Place this at the repository root.

```dockerfile
# ── Stage 1: build the React app ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts

COPY frontend/ .

# Inject the production env at build time
COPY frontend/.env.production .env

RUN npm run build

# ── Stage 2: serve with Nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config is mounted via docker-compose (see step 8)
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

---

## 7. Docker Compose File

Create `docker-compose.yml` at the repository root.

```yaml
version: "3.9"

services:

  # ── PostgreSQL ────────────────────────────────────────────────────────────
  # Only needed if you are NOT using an external managed database (e.g. Neon).
  # If you use Neon, remove this service and point POSTGRES_HOST to Neon.
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
      - backend/.env.production
    depends_on:
      redis:
        condition: service_healthy
      # Remove the db dependency if using an external database
      db:
        condition: service_healthy
    volumes:
      - static_files:/app/staticfiles
      - media_files:/app/media
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
      - backend/.env.production
    depends_on:
      redis:
        condition: service_healthy
      backend:
        condition: service_started
    volumes:
      - media_files:/app/media

  # ── React frontend (Nginx) ────────────────────────────────────────────────
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    restart: unless-stopped
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - static_files:/app/staticfiles:ro
      - media_files:/app/media:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  static_files:
  media_files:
```

> **Using Neon (external database)?**
> Remove the `db` service and the `db` dependency under `backend`. Set `POSTGRES_HOST` in `backend/.env.production` to your Neon host.

---

## 8. Nginx Configuration

Create `nginx/nginx.conf`:

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

    # TLS certificates (generated in step 9)
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 20M;

    # ── Django static files ───────────────────────────────────────────────
    location /static/ {
        alias /app/staticfiles/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # ── User-uploaded media ───────────────────────────────────────────────
    location /media/ {
        alias /app/media/;
        expires 7d;
    }

    # ── WebSocket connections ─────────────────────────────────────────────
    location /ws/ {
        proxy_pass         http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "Upgrade";
        proxy_set_header   Host $host;
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
    }

    # ── Django admin ──────────────────────────────────────────────────────
    location /django-admin/ {
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

## 9. TLS / HTTPS with Let's Encrypt

```bash
# Install Certbot
sudo apt install -y certbot

# Obtain certificates (standalone mode — stop Nginx/Docker first if port 80 is busy)
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

## 10. Build and Deploy

```bash
cd /home/homekonet/app

# Build all images
docker compose build --no-cache

# Start everything in the background
docker compose up -d

# Verify all containers are running
docker compose ps
```

Expected output:
```
NAME                STATUS          PORTS
app-backend-1       Up (healthy)    8000/tcp
app-celery-1        Up              
app-db-1            Up (healthy)    5432/tcp
app-frontend-1      Up              0.0.0.0:80->80, 0.0.0.0:443->443
app-redis-1         Up (healthy)    6379/tcp
```

---

## 11. Running Migrations and Creating a Superuser

Run these **once** after the first deployment, and again after any deployment that includes new migrations.

```bash
# Apply all database migrations
docker compose exec backend python manage.py migrate

# Create the Django admin superuser
docker compose exec backend python manage.py createsuperuser

# (Optional) Load any initial data fixtures
# docker compose exec backend python manage.py loaddata initial_data.json
```

The Django admin panel is available at:
```
https://homekonet.com/django-admin/
```

---

## 12. Updating the Application

```bash
cd /home/homekonet/app

# Pull latest code
git pull origin main

# Rebuild only changed images (Docker cache handles unchanged layers)
docker compose build

# Rolling restart — bring up new containers, then remove old ones
docker compose up -d --force-recreate

# Apply any new migrations
docker compose exec backend python manage.py migrate

# Confirm everything is healthy
docker compose ps
docker compose logs --tail=50 backend
```

To update a single service (e.g. only the backend):

```bash
docker compose build backend
docker compose up -d --no-deps --force-recreate backend
docker compose exec backend python manage.py migrate
```

---

## 13. Monitoring and Logs

```bash
# Live logs for all services
docker compose logs -f

# Logs for a specific service
docker compose logs -f backend
docker compose logs -f celery
docker compose logs -f frontend

# Resource usage
docker stats

# Inspect a running container
docker compose exec backend bash
```

### Setting up log rotation

Docker's default logging can fill your disk. Configure it in `/etc/docker/daemon.json`:

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

---

## 14. Backup and Restore

### Back up the PostgreSQL database

```bash
# Dump (replace <user> and <db> with your values from .env.production)
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB \
  | gzip > /home/homekonet/backups/db_$(date +%Y%m%d_%H%M%S).sql.gz

# Schedule daily backups at 02:00
(crontab -l 2>/dev/null; echo "0 2 * * * docker compose -f /home/homekonet/app/docker-compose.yml \
  exec -T db pg_dump -U \$POSTGRES_USER \$POSTGRES_DB | gzip > \
  /home/homekonet/backups/db_\$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz") | crontab -
```

> If you are using **Neon**, use Neon's built-in branching and point-in-time restore instead.

### Restore from a backup

```bash
gunzip -c /home/homekonet/backups/db_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB
```

### Back up media files

```bash
# Media is stored in Cloudinary in production (configured via CLOUDINARY_URL).
# No local media backup needed if Cloudinary is active.
# If running without Cloudinary, back up the Docker volume:
docker run --rm \
  -v app_media_files:/media \
  -v /home/homekonet/backups:/backup \
  alpine tar czf /backup/media_$(date +%Y%m%d).tar.gz /media
```

---

## 15. Security Hardening Checklist

Before going live, verify all of the following:

**Server**
- [ ] SSH password login disabled; key-based only
- [ ] UFW firewall active — only ports 22, 80, 443 open
- [ ] Fail2ban installed and active
- [ ] Non-root user running the application
- [ ] Automatic security updates enabled (`unattended-upgrades`)

**Django**
- [ ] `DJANGO_DEBUG=false`
- [ ] `DJANGO_SECRET_KEY` is a long random string (≥50 chars), not the dev key
- [ ] `DJANGO_ALLOWED_HOSTS` contains only your domain
- [ ] `SECURE_SSL_REDIRECT=true` and `SECURE_HSTS_SECONDS=31536000`
- [ ] Admin URL is not `/admin/` (rename to `/django-admin/` or similar)
- [ ] `AUTH_REQUIRE_EMAIL_VERIFICATION=true`

**Database**
- [ ] Database not exposed on a public port (only accessible inside Docker network)
- [ ] Strong unique password for the database user

**Secrets**
- [ ] `.env.production` is in `.gitignore` and never committed
- [ ] All API keys are production keys (not test/dev)
- [ ] Stripe webhook secret is set and validated in `payments/views.py`

**TLS**
- [ ] HTTPS enforced; HTTP redirects to HTTPS
- [ ] Certificate auto-renewal cron job is active
- [ ] TLSv1.2 and TLSv1.3 only (no TLS 1.0/1.1)

**Docker**
- [ ] No containers running as root (add `user: "1000:1000"` to services if needed)
- [ ] Sensitive env files have `chmod 600`
- [ ] Docker log rotation configured

**Monitoring**
- [ ] At minimum, set up email alerts when the server is unreachable (UptimeRobot free tier works)
- [ ] Review `docker compose logs` after every deployment

---

## Quick Reference

| Task | Command |
|---|---|
| Start all services | `docker compose up -d` |
| Stop all services | `docker compose down` |
| Rebuild and restart | `docker compose build && docker compose up -d --force-recreate` |
| Run migrations | `docker compose exec backend python manage.py migrate` |
| Open Django shell | `docker compose exec backend python manage.py shell` |
| Tail all logs | `docker compose logs -f` |
| Check container health | `docker compose ps` |
| Restart one service | `docker compose restart backend` |
| Enter a container | `docker compose exec backend bash` |
| Remove all volumes (⚠ destructive) | `docker compose down -v` |
