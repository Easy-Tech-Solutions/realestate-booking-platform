"""
Rule-based fraud signal detectors — deliberately NOT machine learning. Each
function scans real data and creates FraudFlag rows for patterns worth a
human's attention. FraudFlag.ai_score stays null; there's no model behind
these, just straightforward thresholds.

Designed to be safe to re-run repeatedly (e.g. from a periodic task or a
manual "Scan now" button) — each detector skips a signal it has already
raised an open flag for, so re-running never creates duplicates.
"""
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from .models import AccountSignupEvent, FraudFlag

RAPID_SIGNUP_WINDOW_MINUTES = 60
RAPID_SIGNUP_THRESHOLD = 3


def _enqueue_scoring(flag):
    from aiscoring.tasks import score_fraud_flag_task
    score_fraud_flag_task.delay(flag.id)


def detect_rapid_signups(window_minutes=RAPID_SIGNUP_WINDOW_MINUTES, threshold=RAPID_SIGNUP_THRESHOLD):
    """Flag IPs that created >= `threshold` accounts within `window_minutes`."""
    since = timezone.now() - timedelta(minutes=window_minutes)
    created = []

    suspicious_ips = (
        AccountSignupEvent.objects.filter(created_at__gte=since, ip_address__isnull=False)
        .values('ip_address')
        .annotate(n=Count('id'))
        .filter(n__gte=threshold)
    )

    for row in suspicious_ips:
        ip = row['ip_address']
        already_flagged = FraudFlag.objects.filter(
            flag_type=FraudFlag.FlagType.RAPID_SIGNUP,
            status=FraudFlag.Status.OPEN,
            details__contains=ip,
        ).exists()
        if already_flagged:
            continue

        events = AccountSignupEvent.objects.filter(
            ip_address=ip, created_at__gte=since,
        ).select_related('user').order_by('created_at')
        usernames = ', '.join(e.user.username for e in events)
        flag = FraudFlag.objects.create(
            flag_type=FraudFlag.FlagType.RAPID_SIGNUP,
            severity=FraudFlag.Severity.HIGH if row['n'] >= threshold * 2 else FraudFlag.Severity.MEDIUM,
            details=(
                f'{row["n"]} accounts created from IP {ip} within {window_minutes} minutes: {usernames}'
            ),
        )
        created.append(flag)
        _enqueue_scoring(flag)

    return created


def detect_shared_cards():
    """Flag (last4, expiry, card type) combinations saved by more than one
    distinct user — a weak but real proxy for the same physical card being
    used across multiple accounts (we don't store Stripe's card fingerprint
    today, so this is an approximation, not a guarantee)."""
    from payments.models import SavedCard

    created = []
    groups = (
        SavedCard.objects.values('last4', 'expiry_month', 'expiry_year', 'card_type')
        .annotate(n_users=Count('user', distinct=True))
        .filter(n_users__gt=1)
    )

    for g in groups:
        cards = SavedCard.objects.filter(
            last4=g['last4'], expiry_month=g['expiry_month'],
            expiry_year=g['expiry_year'], card_type=g['card_type'],
        ).select_related('user')
        usernames = sorted({c.user.username for c in cards})
        signature = f"{g['card_type']} ****{g['last4']} {g['expiry_month']}/{g['expiry_year']}"

        already_flagged = FraudFlag.objects.filter(
            flag_type=FraudFlag.FlagType.SHARED_CARD,
            status=FraudFlag.Status.OPEN,
            details__contains=signature,
        ).exists()
        if already_flagged:
            continue

        flag = FraudFlag.objects.create(
            flag_type=FraudFlag.FlagType.SHARED_CARD,
            severity=FraudFlag.Severity.MEDIUM,
            details=f'Card {signature} is saved on {len(usernames)} accounts: {", ".join(usernames)}',
        )
        created.append(flag)
        _enqueue_scoring(flag)

    return created


def run_all_detectors():
    return {
        'rapid_signup': detect_rapid_signups(),
        'shared_card': detect_shared_cards(),
    }
