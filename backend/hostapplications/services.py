"""
Service layer for the host-application approval flow.

All stage transitions go through here so the right notification always fires
(mirrors bookings/services.py). The admin/view layers are responsible for
authorization; these functions assume the caller is allowed to act.
"""

import logging

from django.utils import timezone

from .models import HostApplication

logger = logging.getLogger(__name__)


class InvalidTransition(ValueError):
    """Raised when a decision is attempted on an application not at that stage."""


def _safe_notify(fn_name, application):
    """Call a notifications.services function by name, never breaking the transition."""
    try:
        from notifications import services as nsvc
        getattr(nsvc, fn_name)(application)
    except Exception:
        logger.exception('Host-application notification %s failed for #%s', fn_name, application.pk)


def _decline(application, stage, reason, officer):
    application.status = HostApplication.Status.DECLINED
    application.declined_stage = stage
    application.decline_reason = reason or ''
    application.save(update_fields=['status', 'declined_stage', 'decline_reason', 'updated_at'])
    _safe_notify('notify_host_application_declined', application)
    return application


def ps_decision(application, approve, officer, reason=''):
    """Product Support Officer decision on a `submitted` application."""
    if application.status != HostApplication.Status.SUBMITTED:
        raise InvalidTransition('This application is not awaiting Product Support review.')

    application.ps_reviewed_by = officer
    application.ps_reviewed_at = timezone.now()

    if approve:
        application.status = HostApplication.Status.PS_APPROVED
        application.save(update_fields=['status', 'ps_reviewed_by', 'ps_reviewed_at', 'updated_at'])
        _safe_notify('notify_host_application_advanced', application)
        return application

    application.save(update_fields=['ps_reviewed_by', 'ps_reviewed_at'])
    return _decline(application, HostApplication.Stage.PRODUCT_SUPPORT, reason, officer)


def compliance_decision(application, approve, officer, reason=''):
    """Compliance Officer decision on a `ps_approved` application."""
    if application.status != HostApplication.Status.PS_APPROVED:
        raise InvalidTransition('This application is not awaiting Compliance review.')

    application.compliance_reviewed_by = officer
    application.compliance_reviewed_at = timezone.now()

    if approve:
        application.status = HostApplication.Status.COMPLIANCE_APPROVED
        application.save(update_fields=[
            'status', 'compliance_reviewed_by', 'compliance_reviewed_at', 'updated_at',
        ])
        _safe_notify('notify_host_application_advanced', application)
        return application

    application.save(update_fields=['compliance_reviewed_by', 'compliance_reviewed_at'])
    return _decline(application, HostApplication.Stage.COMPLIANCE, reason, officer)


def supervisor_decision(application, approve, officer, reason=''):
    """
    Supervisor decision on a `compliance_approved` application.

    On approval this is the final step: the applicant is promoted to a host
    (role='agent') and notified.
    """
    if application.status != HostApplication.Status.COMPLIANCE_APPROVED:
        raise InvalidTransition('This application is not awaiting Supervisor review.')

    application.supervisor_reviewed_by = officer
    application.supervisor_reviewed_at = timezone.now()

    if approve:
        application.status = HostApplication.Status.APPROVED
        application.save(update_fields=[
            'status', 'supervisor_reviewed_by', 'supervisor_reviewed_at', 'updated_at',
        ])
        _promote_to_host(application.applicant)
        _safe_notify('notify_host_application_approved', application)
        return application

    application.save(update_fields=['supervisor_reviewed_by', 'supervisor_reviewed_at'])
    return _decline(application, HostApplication.Stage.SUPERVISOR, reason, officer)


def _promote_to_host(user):
    """Flip a regular user to a host/agent. Never demote an existing admin/agent."""
    if user.role == 'user':
        user.role = 'agent'
        user.save(update_fields=['role'])
