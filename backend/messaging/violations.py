"""
Anti-bypass violation recording + escalation (Business Policy §11).

Called once per message that scan_message() flagged. Records one
MessageViolation row per detected issue, notifies BOTH parties (not just the
sender — the previous version only nudged the sender), and escalates the
sender to a temporary suspension every VIOLATION_SUSPENSION_THRESHOLD
violations, then to a permanent ban once they've already been auto-suspended
SUSPENSION_BAN_THRESHOLD times by this system.
"""
import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)

# Every Nth violation triggers a temporary suspension.
VIOLATION_SUSPENSION_THRESHOLD = 3
# Once a sender has been auto-suspended this many times by this system, the
# next escalation is a permanent ban instead of another temporary one.
SUSPENSION_BAN_THRESHOLD = 2
AUTO_SUSPENSION_DURATION_DAYS = 7

# Marks a Suspension as having been created by this system (not a human
# admin) so escalation counting can find exactly its own prior actions.
AUTO_SUSPENSION_REASON_PREFIX = '[auto:anti-bypass]'


def record_violations_and_escalate(sender, recipient, conversation, violation_codes):
    """`violation_codes` is the list scan_message() returned (non-empty).
    Never raises — a failure here must not break message sending."""
    if not violation_codes:
        return

    try:
        _record_and_escalate(sender, recipient, conversation, violation_codes)
    except Exception:
        logger.exception('Anti-bypass violation recording failed for sender=%s', getattr(sender, 'id', None))


def _record_and_escalate(sender, recipient, conversation, violation_codes):
    from .models import MessageViolation

    for code in violation_codes:
        if code.startswith('restricted_phrase:'):
            vtype = MessageViolation.ViolationType.RESTRICTED_PHRASE
            label = code.split(':', 1)[1]
        elif code == 'phone_number':
            vtype = MessageViolation.ViolationType.PHONE_NUMBER
            label = ''
        else:
            vtype = MessageViolation.ViolationType.EMAIL
            label = ''
        MessageViolation.objects.create(
            conversation=conversation, sender=sender, recipient=recipient,
            violation_type=vtype, matched_label=label,
        )

    try:
        from notifications.services import notify_message_violation_sender, notify_message_violation_recipient
        notify_message_violation_sender(sender)
        if recipient:
            notify_message_violation_recipient(recipient, sender)
    except Exception:
        logger.exception('Anti-bypass violation notifications failed for sender=%s', getattr(sender, 'id', None))

    total_violations = MessageViolation.objects.filter(sender=sender).count()
    if total_violations % VIOLATION_SUSPENSION_THRESHOLD != 0:
        return

    from suspensions.models import Suspension

    prior_auto_suspensions = Suspension.objects.filter(
        user=sender, reason__startswith=AUTO_SUSPENSION_REASON_PREFIX,
    ).count()

    if prior_auto_suspensions >= SUSPENSION_BAN_THRESHOLD:
        suspension = Suspension.objects.create(
            user=sender, issued_by=None, suspension_type=Suspension.SuspensionType.PERMANENT,
            reason=(
                f'{AUTO_SUSPENSION_REASON_PREFIX} Permanent ban — {prior_auto_suspensions + 1} automatic '
                f'suspensions for repeated attempts to share contact info or move off-platform.'
            ),
        )
    else:
        suspension = Suspension.objects.create(
            user=sender, issued_by=None, suspension_type=Suspension.SuspensionType.TEMPORARY,
            reason=(
                f'{AUTO_SUSPENSION_REASON_PREFIX} {total_violations} detected attempts to share contact '
                f'info or move off-platform.'
            ),
            ends_at=timezone.now() + timedelta(days=AUTO_SUSPENSION_DURATION_DAYS),
        )

    try:
        from notifications.services import notify_account_suspended
        notify_account_suspended(suspension)
    except Exception:
        logger.exception('Auto-suspension notification failed for sender=%s', getattr(sender, 'id', None))
