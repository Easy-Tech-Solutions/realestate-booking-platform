# Security Testing Guide

## Table of Contents
1. [Per-Fix Manual Tests](#per-fix-manual-tests)
2. [Automated Scanning](#automated-scanning)
3. [Manual Penetration Testing](#manual-penetration-testing)
4. [Recommended Additional Headers](#recommended-additional-headers)
5. [CI Integration](#ci-integration)
6. [Priority Reference](#priority-reference)

---

## Per-Fix Manual Tests

### 1. SECRET_KEY Rotation
**What to verify:** The secret key is not hardcoded and is loaded from environment.

```bash
# Confirm no hardcoded secret in settings
grep -r "SECRET_KEY" backend/ --include="*.py" | grep -v "os.environ\|env("

# Check .env is gitignored
cat .gitignore | grep ".env"
```

**Expected:** No hardcoded key found. `.env` appears in `.gitignore`.

---

### 2. Token Expiry — Email Verification (24h) and Password Reset (1h)

**Email verification expiry:**
1. Register a new user → receive verification email
2. In the database, manually set `email_verification_token_expires_at` to a past timestamp
3. Click the verification link
4. **Expected:** `{"error": "Verification link has expired."}` with HTTP 400

```sql
UPDATE authapp_user SET email_verification_token_expires_at = NOW() - INTERVAL '1 hour'
WHERE email = 'test@example.com';
```

**Password reset expiry:**
1. Request password reset → receive email with token
2. Manually set `password_reset_token_expires_at` to a past timestamp
3. Submit the reset form with the token
4. **Expected:** `{"error": "Invalid or expired reset token"}` with HTTP 400

---

### 3. httpOnly Cookie for JWT Refresh Token

**Verify cookie is httpOnly:**
1. Log in via the UI
2. Open DevTools → Application → Cookies → select the backend domain
3. Find `refresh_token` cookie
4. **Expected:** `HttpOnly` column is checked; `Secure` is checked in production

**Verify JavaScript cannot read the cookie:**
```javascript
// Run in DevTools console after login
document.cookie  // refresh_token must NOT appear here
```

**Verify access token is not in localStorage:**
```javascript
localStorage.getItem('accessToken')   // must return null
localStorage.getItem('refreshToken')  // must return null
```

**Verify token refresh works across page reload:**
1. Log in → note you are authenticated
2. Hard reload (`Ctrl+Shift+R`)
3. **Expected:** Still authenticated (session restored via cookie → `/api/auth/refresh-token/`)

---

### 4. IDOR Protection (Object-Level Authorization)

**Booking access:**
```bash
# Log in as User A, get a booking ID that belongs to User B
curl -H "Authorization: Bearer <user_a_token>" \
  https://your-backend.com/api/bookings/<user_b_booking_id>/

# Expected: 403 or 404
```

**Listing modification:**
```bash
# Attempt to edit a listing owned by another host
curl -X PATCH -H "Authorization: Bearer <other_host_token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hacked"}' \
  https://your-backend.com/api/listings/<listing_id>/

# Expected: 403 Forbidden
```

---

### 5. OTP Entropy

**Verify OTP is 6-digit numeric:**
1. Trigger OTP flow (e.g., two-factor or phone verification)
2. Check OTP length and character set in the email/SMS
3. **Expected:** Exactly 6 digits, 0–9 only (1,000,000 possible values)

**Verify OTP is not reusable:**
1. Receive OTP → use it successfully
2. Submit the same OTP again
3. **Expected:** Error indicating OTP is invalid or already used

---

### 6. CORS

**Verify unauthorized origins are rejected:**
```bash
curl -H "Origin: https://attacker.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.com/api/auth/login/

# Check response headers
# Expected: Access-Control-Allow-Origin does NOT include attacker.com
```

**Verify allowed origin works:**
```bash
curl -H "Origin: https://realestate-booking-platform.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.com/api/auth/login/

# Expected: Access-Control-Allow-Origin: https://realestate-booking-platform.vercel.app
```

---

### 7. X-Forwarded-For / IP Spoofing

**Verify spoofed headers are not trusted blindly:**
```bash
curl -H "X-Forwarded-For: 1.2.3.4" \
  -H "Authorization: Bearer <token>" \
  https://your-backend.com/api/some-rate-limited-endpoint/

# If rate limiting is based on IP, a spoofed X-Forwarded-For should NOT bypass it
```

**Check Django setting:**
```python
# settings.py should have TRUSTED_PROXIES configured, not USE_X_FORWARDED_HOST=True blindly
```

---

### 8. Webhook Signature (Mandatory HMAC)

**Verify unsigned webhooks are rejected:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"type": "payment.completed", "amount": 1000}' \
  https://your-backend.com/api/payments/webhook/

# Expected: {"error": "Invalid signature"} with HTTP 401
```

**Verify tampered payload is rejected:**
```bash
# Sign a payload, then modify the payload before sending
PAYLOAD='{"type":"payment.completed","amount":1000}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-webhook-secret" | cut -d' ' -f2)
TAMPERED='{"type":"payment.completed","amount":999999}'

curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$TAMPERED" \
  https://your-backend.com/api/payments/webhook/

# Expected: {"error": "Invalid signature"} with HTTP 401
```

---

### 9. File Upload Validation

**Test dangerous file types:**
```bash
# Attempt to upload a .php, .exe, .sh, .py file disguised as an image
curl -X POST \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@malicious.php;type=image/jpeg" \
  https://your-backend.com/api/listings/<id>/images/

# Expected: 400 Bad Request — file type not allowed
```

**Test oversized file:**
```bash
# Generate a 20MB file and attempt upload (if limit is 10MB)
dd if=/dev/urandom of=large.bin bs=1M count=20
curl -X POST \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@large.bin;type=image/jpeg" \
  https://your-backend.com/api/listings/<id>/images/

# Expected: 400 or 413 — file too large
```

---

### 10. Booking ID Not Exposed in URL

**Verify booking confirmation uses opaque reference:**
1. Complete a booking
2. Check the confirmation URL
3. **Expected:** URL does not contain a sequential integer booking ID (e.g., uses UUID or redirects without ID)

---

### 11. Stripe Elements (No Raw Card Data)

**Verify card data never touches your server:**
1. Open DevTools → Network tab
2. Complete a payment
3. Search all requests to your backend domain for: `card_number`, `cvv`, `cvc`, `expiry`, `exp_month`
4. **Expected:** None of these fields appear in any request to your backend

**Verify PaymentIntent flow:**
1. In Network tab, find the request to `/api/payments/stripe/payment-intent/`
2. Check request body — should contain `amount_cents` and `currency` only
3. Find the Stripe API call (to `api.stripe.com`) — this carries the tokenized card data

---

## Automated Scanning

### Backend — Python/Django

**Bandit (static analysis for security issues):**
```bash
pip install bandit
bandit -r backend/ -ll -ii
```
Flags: `-ll` = medium+ severity, `-ii` = medium+ confidence. Review all `HIGH` findings.

**Safety (known vulnerable packages):**
```bash
pip install safety
safety check -r backend/requirements.txt
```

**Semgrep (semantic code patterns):**
```bash
pip install semgrep
semgrep --config=p/django backend/
semgrep --config=p/python backend/
```

### Frontend — JavaScript/TypeScript

**npm audit:**
```bash
cd frontend
npm audit
npm audit --audit-level=high  # fail only on high/critical
```

**Semgrep for React:**
```bash
semgrep --config=p/react frontend/src/
semgrep --config=p/javascript frontend/src/
```

### Container / Infrastructure

**Trivy (Docker image scanning):**
```bash
docker build -t realestate-backend ./backend
trivy image realestate-backend

docker build -t realestate-frontend ./frontend
trivy image realestate-frontend
```

### DAST — OWASP ZAP

**Automated active scan:**
```bash
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://your-backend.com \
  -r zap-report.html

# Full active scan (more thorough, more aggressive):
docker run -t owasp/zap2docker-stable zap-full-scan.py \
  -t https://your-backend.com \
  -r zap-full-report.html
```

**Spider + active scan via ZAP GUI:**
1. Launch ZAP → Automated Scan → enter target URL
2. Run spider to discover endpoints
3. Run Active Scan
4. Review Alerts tab — address High and Medium findings

---

## Manual Penetration Testing

### Authentication

**Brute Force / Rate Limiting:**
```bash
# Attempt rapid login requests
for i in {1..20}; do
  curl -s -X POST https://your-backend.com/api/auth/login/ \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrong'$i'"}' &
done
wait

# Expected: After N failures, subsequent attempts return 429 Too Many Requests
```

**Credential Stuffing simulation:**
```bash
# Test with a list of common username:password pairs
while IFS=: read user pass; do
  curl -s -o /dev/null -w "%{http_code} $user\n" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}"
done < common-credentials.txt

# Expected: 429 throttle kicks in before many attempts succeed
```

**JWT Tampering:**
```bash
# Decode the access token (base64)
TOKEN="<your_access_token>"
HEADER=$(echo $TOKEN | cut -d. -f1 | base64 -d 2>/dev/null)
PAYLOAD=$(echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null)

# Attempt: change algorithm to "none" (algorithm confusion attack)
# Craft: {"alg":"none"}.{"user_id":1,"is_admin":true}.
FAKE_HEADER=$(echo -n '{"alg":"none","typ":"JWT"}' | base64 | tr -d '=')
FAKE_PAYLOAD=$(echo -n '{"user_id":1,"is_admin":true}' | base64 | tr -d '=')
FAKE_TOKEN="$FAKE_HEADER.$FAKE_PAYLOAD."

curl -H "Authorization: Bearer $FAKE_TOKEN" \
  https://your-backend.com/api/admin/dashboard/

# Expected: 401 Unauthorized
```

### SQL Injection

**Test API parameters:**
```bash
# In search/filter parameters
curl "https://your-backend.com/api/listings/?location=London'%20OR%201=1--"
curl "https://your-backend.com/api/listings/?min_price=0%20UNION%20SELECT%201,2,3--"

# Expected: Normal results or error — NOT a database dump or 500 error
```

**Using sqlmap (automated):**
```bash
sqlmap -u "https://your-backend.com/api/listings/?location=London" \
  --level=3 --risk=2 --batch
```

### Cross-Site Scripting (XSS)

**Test stored XSS via listing fields:**
```bash
curl -X POST https://your-backend.com/api/listings/ \
  -H "Authorization: Bearer <host_token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"<script>alert(document.cookie)</script>","description":"test",...}'

# Then view the listing in a browser
# Expected: Script tags are escaped/sanitized — no alert dialog
```

**Test reflected XSS via search:**
```
https://your-backend.com/search?q=<img src=x onerror=alert(1)>
```
Expected: Input is HTML-encoded in the response.

### Business Logic

**Price manipulation:**
```bash
# Attempt to book with a manipulated price
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"start_date":"2026-06-01","end_date":"2026-06-05","total_price":1}'

# Expected: Server calculates price server-side; booking rejected or corrected if price doesn't match
```

**Double booking:**
```bash
# Send two simultaneous booking requests for the same room/dates
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <token>" \
  -d '{"listing":1,"start_date":"2026-06-01","end_date":"2026-06-05"}' &

curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <token>" \
  -d '{"listing":1,"start_date":"2026-06-01","end_date":"2026-06-05"}' &

wait
# Expected: Only one booking succeeds; the second returns an availability error
```

**Negative dates / invalid ranges:**
```bash
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <token>" \
  -d '{"listing":1,"start_date":"2026-06-10","end_date":"2026-06-01"}'
# Expected: 400 — end date before start date
```

### Broken Access Control

**Escalate to admin:**
```bash
# Attempt to access admin endpoints as a regular user
curl -H "Authorization: Bearer <regular_user_token>" \
  https://your-backend.com/api/admin/dashboard/
# Expected: 403 Forbidden

# Attempt to access host endpoints as a non-host
curl -H "Authorization: Bearer <regular_user_token>" \
  https://your-backend.com/api/listings/
  -X POST -d '{"title":"test",...}'
# Expected: 403 Forbidden
```

**Modify another user's booking:**
```bash
curl -X PATCH \
  -H "Authorization: Bearer <user_a_token>" \
  -d '{"status":"cancelled"}' \
  https://your-backend.com/api/bookings/<user_b_booking_id>/
# Expected: 403 or 404
```

### Security Headers Check

```bash
curl -I https://your-backend.com/api/auth/login/

# Verify presence of:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Referrer-Policy: strict-origin-when-cross-origin
# Content-Security-Policy: (present)
# Permissions-Policy: (present)
```

Use **securityheaders.com** or **observatory.mozilla.org** for a full graded report.

---

## Recommended Additional Headers

Add to `backend/settings.py`:

```python
# Security headers (also enforced by middleware)
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = not DEBUG  # Redirect HTTP → HTTPS in production

# CSP via django-csp package (pip install django-csp)
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'", "https://js.stripe.com")
CSP_FRAME_SRC = ("'self'", "https://js.stripe.com")
CSP_IMG_SRC = ("'self'", "data:", "https:")
CSP_CONNECT_SRC = ("'self'", "https://api.stripe.com")

MIDDLEWARE = [
    # Add near the top:
    'csp.middleware.CSPMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # ... rest of middleware
]
```

---

## CI Integration

### GitHub Actions — Security Pipeline

Create `.github/workflows/security.yml`:

```yaml
name: Security Checks

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  backend-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r backend/requirements.txt
          pip install bandit safety semgrep

      - name: Bandit static analysis
        run: bandit -r backend/ -ll -ii --exit-zero

      - name: Safety check
        run: safety check -r backend/requirements.txt

      - name: Semgrep Django
        run: semgrep --config=p/django backend/ --error

  frontend-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: npm audit
        run: cd frontend && npm audit --audit-level=high

      - name: Semgrep React
        run: semgrep --config=p/react frontend/src/ --error
```

### Pre-commit Hooks

Create `.pre-commit-config.yaml` in project root:

```yaml
repos:
  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.5
    hooks:
      - id: bandit
        args: ["-ll", "-ii"]
        files: backend/

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

Install: `pip install pre-commit && pre-commit install`

---

## Priority Reference

| Priority | Fix | Risk if Skipped |
|----------|-----|----------------|
| CRITICAL | SECRET_KEY from environment | Complete session/CSRF compromise |
| CRITICAL | httpOnly cookie for JWT | Token theft via XSS |
| CRITICAL | Webhook signature mandatory | Fake payment events accepted |
| CRITICAL | Stripe Elements (no raw card) | PCI DSS violation, card data exposure |
| HIGH | Token expiry checks | Indefinite use of compromised tokens |
| HIGH | IDOR protection | Users access/modify each other's data |
| HIGH | CORS lockdown | Cross-origin data access |
| HIGH | File upload validation | Remote code execution |
| MEDIUM | OTP entropy | OTP brute-force feasible |
| MEDIUM | X-Forwarded-For trust | IP-based rate limiting bypass |
| MEDIUM | Booking ID not in URL | Sequential enumeration of bookings |
| LOW | Security headers (CSP, HSTS) | Clickjacking, protocol downgrade |
| LOW | Rate limiting on auth | Brute force / credential stuffing |
