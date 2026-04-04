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
