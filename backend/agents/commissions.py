"""
Sourcing-agent commission logic: created when Home Konet confirms a guest
payment on an agent-sourced booking, voided if that booking is later refunded
before the commission is disbursed.
"""
import logging
from decimal import Decimal

from django.utils import timezone

from .models import AgentCommission

logger = logging.getLogger(__name__)


def _booking_rent(booking) -> Decimal:
    """The rent basis (B) — what the guest paid for the stay, excluding their fee."""
    if getattr(booking, 'total_price', None) is not None:
        return (Decimal(booking.total_price) - Decimal(booking.service_fee or 0)).quantize(Decimal('0.01'))
    return Decimal(booking.total_amount).quantize(Decimal('0.01'))


def create_agent_commission_for_booking(booking):
    """
    Create (idempotently) the agent commission for a confirmed agent-sourced
    booking. No-op for non-agent listings. Notifies the agent that it's earned.
    """
    listing = booking.listing
    agent = getattr(listing, 'sourced_by_agent', None)
    if agent is None:
        return None  # not agent-sourced
    if AgentCommission.objects.filter(booking=booking).exists():
        return booking.agent_commission

    from payments.models import get_agent_commission_rate
    rent = _booking_rent(booking)
    amount = (rent * get_agent_commission_rate()).quantize(Decimal('0.01'))

    commission = AgentCommission.objects.create(
        booking=booking, agent=agent, listing=listing,
        booking_amount=rent, amount=amount,
    )
    try:
        from notifications import services as nsvc
        nsvc.notify_agent_commission_earned(commission)
    except Exception:
        logger.exception('notify_agent_commission_earned failed for booking #%s', booking.pk)
    return commission


def void_agent_commission(booking, reason=''):
    """
    Clawback: void a still-PENDING commission (e.g. the booking was refunded
    before disbursement). A commission already PAID is left as-is.
    """
    commission = AgentCommission.objects.filter(
        booking=booking, status=AgentCommission.Status.PENDING,
    ).first()
    if commission is None:
        return None
    commission.status = AgentCommission.Status.VOIDED
    commission.voided_at = timezone.now()
    if reason:
        commission.notes = reason
    commission.save(update_fields=['status', 'voided_at', 'notes', 'updated_at'])
    return commission
