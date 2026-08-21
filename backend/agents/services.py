"""
Service layer for the sourcing-agent onboarding flow. Mirrors
hostapplications.services; approval grants an AgentProfile capability instead
of changing the user's role.
"""

import logging

from django.utils import timezone

from .models import AgentApplication, AgentProfile

logger = logging.getLogger(__name__)


class InvalidTransition(ValueError):
    """Raised when a decision is attempted on an application not at that stage."""


def _safe_notify(fn_name, application):
    try:
        from notifications import services as nsvc
        getattr(nsvc, fn_name)(application)
    except Exception:
        logger.exception('Agent-application notification %s failed for #%s', fn_name, application.pk)


def _decline(application, stage, reason):
    application.status = AgentApplication.Status.DECLINED
    application.declined_stage = stage
    application.decline_reason = reason or ''
    application.save(update_fields=['status', 'declined_stage', 'decline_reason', 'updated_at'])
    _safe_notify('notify_agent_application_declined', application)
    return application


def _grant_agent_capability(application):
    """Give the applicant the approved sourcing-agent capability (idempotent)."""
    profile, _ = AgentProfile.objects.get_or_create(user=application.applicant)
    profile.is_active = True
    profile.approved_at = timezone.now()
    profile.application = application
    profile.save(update_fields=['is_active', 'approved_at', 'application'])
    return profile


def ps_decision(application, approve, officer, reason=''):
    if application.status != AgentApplication.Status.SUBMITTED:
        raise InvalidTransition('This application is not awaiting Product Support review.')
    application.ps_reviewed_by = officer
    application.ps_reviewed_at = timezone.now()
    if approve:
        application.status = AgentApplication.Status.PS_APPROVED
        application.save(update_fields=['status', 'ps_reviewed_by', 'ps_reviewed_at', 'updated_at'])
        _safe_notify('notify_agent_application_advanced', application)
        _safe_notify('notify_agent_application_progress', application)
        return application
    application.save(update_fields=['ps_reviewed_by', 'ps_reviewed_at'])
    return _decline(application, AgentApplication.Stage.PRODUCT_SUPPORT, reason)


def compliance_decision(application, approve, officer, reason=''):
    if application.status != AgentApplication.Status.PS_APPROVED:
        raise InvalidTransition('This application is not awaiting Compliance review.')
    application.compliance_reviewed_by = officer
    application.compliance_reviewed_at = timezone.now()
    if approve:
        application.status = AgentApplication.Status.COMPLIANCE_APPROVED
        application.save(update_fields=[
            'status', 'compliance_reviewed_by', 'compliance_reviewed_at', 'updated_at',
        ])
        _safe_notify('notify_agent_application_advanced', application)
        _safe_notify('notify_agent_application_progress', application)
        return application
    application.save(update_fields=['compliance_reviewed_by', 'compliance_reviewed_at'])
    return _decline(application, AgentApplication.Stage.COMPLIANCE, reason)


def supervisor_decision(application, approve, officer, reason=''):
    if application.status != AgentApplication.Status.COMPLIANCE_APPROVED:
        raise InvalidTransition('This application is not awaiting Supervisor review.')
    application.supervisor_reviewed_by = officer
    application.supervisor_reviewed_at = timezone.now()
    if approve:
        application.status = AgentApplication.Status.APPROVED
        application.save(update_fields=[
            'status', 'supervisor_reviewed_by', 'supervisor_reviewed_at', 'updated_at',
        ])
        _grant_agent_capability(application)
        _safe_notify('notify_agent_application_approved', application)
        return application
    application.save(update_fields=['supervisor_reviewed_by', 'supervisor_reviewed_at'])
    return _decline(application, AgentApplication.Stage.SUPERVISOR, reason)
