# Backend Testing

Use this folder for backend test assets.

## What to store here

- Test plans
- Sample payloads/fixtures
- Test run reports
- Notes on regressions

## Quick commands

```bash
cd backend
python manage.py test
python manage.py test -v 2
```

## Existing standalone backend test scripts

```bash
cd backend
python test_booking.py
python test_booking_django.py
python test_permissions.py
python test_permissions_proper.py
```

## MTN MoMo live gateway test commands

These hit MTN's real Collection/Disbursement API directly through
`MTNMoMoGateway` — no booking, no Payment row, no frontend involved. Use them
to check basic connectivity/credentials/currency support in isolation before
troubleshooting the full app flow. Run from the repo root (`/opt/homekonet`
in production) via the running `backend` container — swap `docker compose
exec` for `docker compose run --rm --no-deps --entrypoint python` if you
want to test against a not-yet-deployed image instead of the live one.

### 1. Check which API user each currency/product actually resolves to

Useful after touching `MTN_MOMO_*` env vars or `PAYMENT_GATEWAYS` in
`settings.py` — confirms Collection and Disbursement aren't accidentally
pointing at the same account (MTN ties an API user to one product only; a
Disbursement-only account authenticates fine on a Collection call but MTN
rejects the actual transaction with `NOT_ALLOWED`).

```bash
docker compose exec backend python manage.py shell -c "
from payments.models import PaymentGateway
from payments.gateways.mtn_momo import MTNMoMoGateway

gw = MTNMoMoGateway(PaymentGateway.objects.get(name='mtn_momo'))
for currency in ('USD', 'LRD'):
    for product in ('collection', 'disbursement'):
        acct = gw._account_for(currency, product)
        print(f'{currency}/{product}: user_id={acct[\"user_id\"]}')
"
```

### 2. Submit a live Collection request-to-pay

Sends a real push to the given phone number for a real (small) amount —
this moves real money if approved. Replace the phone number and currency
(`USD` or `LRD`) before running.

```bash
docker compose exec backend python manage.py shell -c "
import uuid, json
from payments.models import PaymentGateway
from payments.gateways.mtn_momo import MTNMoMoGateway

gw = MTNMoMoGateway(PaymentGateway.objects.get(name='mtn_momo'))
result = gw.process_payment({
    'amount': 1,
    'phone_number': '0770000000',
    'currency': 'USD',
    'payment_id': str(uuid.uuid4()),
})
print('SUBMIT:', json.dumps(result, indent=2, default=str))
"
```

`success: true` here only means MTN *accepted* the request and gave it a
real transaction reference — it does not mean the payment succeeded. A
`success: false` result at this step (before any prompt is sent) points to a
credentials/config problem, not a payer-side issue.

### 3. Check the final status of a submitted transaction

Use the `transaction_id` printed by step 2. Must use the same `currency` the
request was submitted with (it selects which account's credentials
authenticate the poll).

```bash
docker compose exec backend python manage.py shell -c "
import json
from payments.models import PaymentGateway
from payments.gateways.mtn_momo import MTNMoMoGateway

gw = MTNMoMoGateway(PaymentGateway.objects.get(name='mtn_momo'))
result = gw.verify_payment('PASTE_TRANSACTION_ID_HERE', currency='USD')
print('VERIFY:', json.dumps(result, indent=2, default=str))
"
```

`mtn_status` will be one of `PENDING` (still awaiting the payer's approval —
re-run this after they've had a chance to approve/decline on their phone),
`SUCCESSFUL` (completed — full transaction detail, including
`financialTransactionId`, is in `gateway_data`), or `FAILED` with a `reason`
code in `gateway_data` (e.g. `NOT_ALLOWED`,
`NOT_ALLOWED_TARGET_ENVIRONMENT`, `LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED`
— these are MTN's own decline reasons, not bugs in this codebase; anything
in this family should go back to MTN's partner support with the reference
number, not be treated as something to fix here).

### 4. Submit + verify in one shot

Combines steps 2–3 with a short wait, so there's no copy-paste of the
transaction ID between two separate commands (a common mistake — verifying
with a stale/placeholder ID just gets a 400 from MTN).

```bash
docker compose exec backend python manage.py shell -c "
import uuid, json, time
from payments.models import PaymentGateway
from payments.gateways.mtn_momo import MTNMoMoGateway

gw = MTNMoMoGateway(PaymentGateway.objects.get(name='mtn_momo'))
result = gw.process_payment({'amount': 1, 'phone_number': '0770000000', 'currency': 'USD', 'payment_id': str(uuid.uuid4())})
print('SUBMIT:', json.dumps(result, indent=2, default=str))

if result.get('success'):
    time.sleep(5)
    verify = gw.verify_payment(result['transaction_id'], currency='USD')
    print('VERIFY:', json.dumps(verify, indent=2, default=str))
"
```

If the payer hasn't approved yet within those 5 seconds, `VERIFY` will still
show `PENDING` — that's normal; just re-run step 3 with the same
transaction ID a bit later rather than re-submitting a new request.

### 5. Same test, in LRD

Only the `currency` value changes — both currencies resolve to the same
Collection/Disbursement accounts by default (confirmed with MTN 2026-09-08;
an API user is not currency-locked). The wire amount MTN actually charges is
whatever whole number you pass here, in the given currency — this script
does **not** apply the USD→LRD conversion the real checkout flow uses
(see `PaymentService.convert_from_usd`), so don't read too much into the
LRD amount unless you're deliberately testing that conversion via the real
`/api/payments/initiate/` endpoint instead.

```bash
docker compose exec backend python manage.py shell -c "
import uuid, json, time
from payments.models import PaymentGateway
from payments.gateways.mtn_momo import MTNMoMoGateway

gw = MTNMoMoGateway(PaymentGateway.objects.get(name='mtn_momo'))
result = gw.process_payment({'amount': 1, 'phone_number': '0770000000', 'currency': 'LRD', 'payment_id': str(uuid.uuid4())})
print('SUBMIT:', json.dumps(result, indent=2, default=str))

if result.get('success'):
    time.sleep(5)
    verify = gw.verify_payment(result['transaction_id'], currency='LRD')
    print('VERIFY:', json.dumps(verify, indent=2, default=str))
"
```

### 6. Confirm a real Payment row's stored gateway response

If a payment was made through the actual app (not the standalone scripts
above) and you need to see MTN's full raw response — including the
`reason` code on a failure — without digging through log files, it's saved
on the `Payment` row itself:

```bash
docker compose exec backend python manage.py shell -c "
from payments.models import Payment
import json
p = Payment.objects.filter(booking_id=BOOKING_ID_HERE).order_by('-id').first()
print('status:', p.status)
print('gateway_response:', json.dumps(p.gateway_response, indent=2, default=str))
"
```
