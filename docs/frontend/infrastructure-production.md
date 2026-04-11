# Frontend Production Infrastructure (Linux)

This guide covers production deployment of the React + Vite frontend on Linux, including build pipeline, environment variables, and reverse proxy configuration.

## 1. Target Architecture

- Build tool: Vite
- Hosting: Nginx static hosting (or CDN + object storage)
- Domain: app.yourdomain.com
- Backend API domain: api.yourdomain.com
- WebSocket endpoint: wss://api.yourdomain.com

## 2. Build Server Requirements

- Node.js 18+
- npm (or pnpm if preferred)
- Linux runner/host (Ubuntu 22.04+ recommended)

Install Node.js and npm if needed.

## 3. Frontend Environment Variables

Create frontend/.env.production:

```env
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=wss://api.yourdomain.com
```

The app reads these in frontend/src/core/constants.ts.

## 4. Install and Build

```bash
cd /srv/realestate/app/frontend
npm install
npm run lint
npm run typecheck
npm run build
```

Build output is generated in frontend/dist.

## 5. Deploy Dist Artifacts

Option A: Nginx static hosting on same server.

```bash
sudo mkdir -p /var/www/realestate-frontend
sudo rsync -av --delete dist/ /var/www/realestate-frontend/
```

Option B: Upload dist to object storage/CDN (S3, R2, etc.) and configure custom domain.

## 6. Nginx Static Hosting Example

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    root /var/www/realestate-frontend;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|webp)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800, immutable";
    }
}
```

Then enable TLS:

```bash
sudo certbot --nginx -d app.yourdomain.com
```

## 7. SPA Routing and API Boundary

- Ensure all frontend routes fall back to index.html.
- API calls should point to VITE_API_URL and never use localhost in production.
- WebSocket URL should use wss:// in production.

## 8. CORS and Backend Alignment

Backend must include:

- FRONTEND_ORIGIN=https://app.yourdomain.com
- CORS_ALLOWED_ORIGINS=https://app.yourdomain.com

If frontend and backend domains do not match these values, auth and API requests will fail.

## 9. Release Validation

From repository root:

```bash
bash scripts/release-check.sh
```

This validates backend readiness and frontend lint/typecheck/build as one gate.

## 10. Post-Deploy Smoke Tests

After deployment, verify:

- app loads over HTTPS
- login, register, and token refresh flow works
- host/dashboard routes load for authenticated users
- booking + payment flow reaches backend without CORS errors
- websocket-powered messaging and notifications connect successfully
