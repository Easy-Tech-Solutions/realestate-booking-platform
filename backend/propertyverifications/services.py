"""
Service layer for the property verification flow.

All stage transitions go through here so the right notifications fire and the
listing's publish state stays in sync. Authorization is enforced by the admin /
view layers; these functions assume the caller is allowed to act.
"""

import logging

from django.utils import timezone

from .models import PropertyVerification

logger = logging.getLogger(__name__)

# Reviewer decision values (used by the admin).
APPROVE            = 'approve'
REJECT             = 'reject'
REQUEST_CORRECTION = 'request_correction'


class InvalidTransition(ValueError):
    """Raised when a decision is attempted on a verification not at that stage."""


def _safe_notify(fn_name, verification):
    try:
        from notifications import services as nsvc
        getattr(nsvc, fn_name)(verification)
    except Exception:
        logger.exception('Property-verification notification %s failed for #%s', fn_name, verification.pk)


def _set_listing_status(verification, new_status):
    listing = verification.listing
    if listing.status != new_status:
        listing.status = new_status
        listing.save(update_fields=['status'])


def _reject(verification, stage, notes):
    verification.status = PropertyVerification.Status.REJECTED
    verification.outcome_stage = stage
    verification.review_notes = notes or ''
    verification.save(update_fields=['status', 'outcome_stage', 'review_notes', 'updated_at'])
    _set_listing_status(verification, 'rejected')
    _safe_notify('notify_property_verification_rejected', verification)
    return verification


def _request_correction(verification, stage, notes):
    verification.status = PropertyVerification.Status.CORRECTION_REQUESTED
    verification.outcome_stage = stage
    verification.review_notes = notes or ''
    verification.save(update_fields=['status', 'outcome_stage', 'review_notes', 'updated_at'])
    # Listing stays pending_review (unpublished) while the host makes corrections.
    _set_listing_status(verification, 'pending_review')
    _safe_notify('notify_property_verification_correction', verification)
    return verification


def _apply_decision(verification, decision, stage, notes, approved_status, on_approve=None):
    """Shared approve/reject/request-correction handling for one stage."""
    if decision == APPROVE:
        verification.status = approved_status
        verification.save(update_fields=['status', 'updated_at',
                                          *_stage_fields(stage)])
        if on_approve:
            on_approve(verification)
        else:
            _safe_notify('notify_property_verification_advanced', verification)
            _safe_notify('notify_property_verification_progress', verification)
        return verification

    # Persist the reviewer stamp, then branch to reject / correction.
    verification.save(update_fields=[*_stage_fields(stage), 'updated_at'])
    if decision == REQUEST_CORRECTION:
        return _request_correction(verification, stage, notes)
    return _reject(verification, stage, notes)


def _stage_fields(stage):
    return {
        PropertyVerification.Stage.PRODUCT_SUPPORT: ['ps_reviewed_by', 'ps_reviewed_at'],
        PropertyVerification.Stage.COMPLIANCE:      ['compliance_reviewed_by', 'compliance_reviewed_at'],
        PropertyVerification.Stage.SUPERVISOR:      ['supervisor_reviewed_by', 'supervisor_reviewed_at'],
    }[stage]


def ps_decision(verification, decision, officer, notes=''):
    """Product Support Officer decision on a `submitted` verification."""
    if verification.status != PropertyVerification.Status.SUBMITTED:
        raise InvalidTransition('This verification is not awaiting Product Support review.')
    verification.ps_reviewed_by = officer
    verification.ps_reviewed_at = timezone.now()
    return _apply_decision(
        verification, decision, PropertyVerification.Stage.PRODUCT_SUPPORT, notes,
        approved_status=PropertyVerification.Status.PS_APPROVED,
    )


def compliance_decision(verification, decision, officer, notes='', inspection_data=None):
    """Compliance Officer decision on a `ps_approved` verification.

    `inspection_data` (only used/required on APPROVE) carries the physical
    site-visit record: due_diligence_done, inspection_report (file),
    inspection_latitude/inspection_longitude (GPS coordinates captured
    on-site) — see the Home Konnect Business Policy's Compliance-stage
    requirements (site inspection, photo validation, GPS coordinates)."""
    if verification.status != PropertyVerification.Status.PS_APPROVED:
        raise InvalidTransition('This verification is not awaiting Compliance review.')

    if decision == APPROVE:
        inspection_data = inspection_data or {}
        update_fields = []
        if inspection_data.get('due_diligence_done') is not None:
            verification.due_diligence_done = inspection_data['due_diligence_done']
            update_fields.append('due_diligence_done')
        if inspection_data.get('inspection_report') is not None:
            verification.inspection_report = inspection_data['inspection_report']
            update_fields.append('inspection_report')
        if inspection_data.get('inspection_latitude') is not None:
            verification.inspection_latitude = inspection_data['inspection_latitude']
            update_fields.append('inspection_latitude')
        if inspection_data.get('inspection_longitude') is not None:
            verification.inspection_longitude = inspection_data['inspection_longitude']
            update_fields.append('inspection_longitude')
        if update_fields:
            verification.save(update_fields=update_fields)

        if not verification.due_diligence_done or not verification.inspection_report:
            raise InvalidTransition(
                'A completed site inspection (due-diligence confirmation + inspection report) '
                'is required before Compliance can approve.'
            )

    verification.compliance_reviewed_by = officer
    verification.compliance_reviewed_at = timezone.now()
    return _apply_decision(
        verification, decision, PropertyVerification.Stage.COMPLIANCE, notes,
        approved_status=PropertyVerification.Status.COMPLIANCE_APPROVED,
    )


def supervisor_decision(verification, decision, officer, notes=''):
    """
    Supervisor decision on a `compliance_approved` verification. Final step —
    approval publishes the listing.
    """
    if verification.status != PropertyVerification.Status.COMPLIANCE_APPROVED:
        raise InvalidTransition('This verification is not awaiting Supervisor review.')
    verification.supervisor_reviewed_by = officer
    verification.supervisor_reviewed_at = timezone.now()

    def _publish(v):
        # Go live: publish AND make available (listings are created unavailable
        # while unverified).
        listing = v.listing
        listing.status = 'published'
        listing.is_available = True
        listing.save(update_fields=['status', 'is_available'])
        _safe_notify('notify_property_verification_published', v)

    return _apply_decision(
        verification, decision, PropertyVerification.Stage.SUPERVISOR, notes,
        approved_status=PropertyVerification.Status.APPROVED,
        on_approve=_publish,
    )


def resubmit(verification):
    """
    Host resubmits after a correction request. Re-enters review at the Product
    Support stage.
    """
    if verification.status != PropertyVerification.Status.CORRECTION_REQUESTED:
        raise InvalidTransition('This verification is not awaiting correction.')
    verification.status = PropertyVerification.Status.SUBMITTED
    verification.outcome_stage = ''
    verification.review_notes = ''
    verification.resubmission_count += 1
    verification.save(update_fields=[
        'status', 'outcome_stage', 'review_notes', 'resubmission_count', 'updated_at',
    ])
    _set_listing_status(verification, 'pending_review')
    _safe_notify('notify_property_verification_submitted', verification)
    return verification
