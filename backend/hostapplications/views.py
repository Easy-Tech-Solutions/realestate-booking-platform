from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import HostApplication
from .serializers import HostApplicationCreateSerializer, HostApplicationSerializer
from . import agreements
from .services import ps_decision, compliance_decision, supervisor_decision, InvalidTransition


def _client_ip(request):
    """Best-effort client IP, honouring the proxy's X-Forwarded-For (first hop)."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _agreement_payload(user):
    """Current agreement metadata + this user's acceptance state."""
    accepted = agreements.latest_acceptance(user)
    return {
        'version':        agreements.CURRENT_AGREEMENT_VERSION,
        'effective_date': agreements.AGREEMENT_EFFECTIVE_DATE,
        'title':          agreements.AGREEMENT_TITLE,
        'accepted':       agreements.has_accepted_current(user),
        'accepted_version': accepted.version if accepted else None,
        'accepted_at':      accepted.accepted_at.isoformat() if accepted else None,
    }


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def host_applications_collection(request):
    """
    POST /api/host-applications/ — submit a new host application.

    The applicant is taken from the authenticated user; the email shown on the
    form is read-only and is never trusted from the request body.
    """
    serializer = HostApplicationCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    application = serializer.save(applicant=request.user)

    # Record the Property Owner Agreement acceptance for audit (version + IP +
    # timestamp + user). The serializer already enforced the checkbox was ticked.
    agreements.record_acceptance(request.user, ip_address=_client_ip(request))

    # Notify the Product Support Officers that a new application is waiting, and
    # confirm receipt to the applicant.
    try:
        from notifications.services import (
            notify_host_application_submitted, notify_host_application_received,
        )
        notify_host_application_submitted(application)   # → reviewers
        notify_host_application_received(application)     # → applicant
    except Exception:
        pass  # Never let a notification failure break the submission.

    return Response(
        HostApplicationSerializer(application, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def agreement_status(request):
    """
    GET /api/host-applications/agreement/ — current Property Owner Agreement
    version + whether the authenticated user has accepted it. Used to gate the
    'list a property' flow and to show acceptance state in the dashboard.
    """
    return Response(_agreement_payload(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_agreement(request):
    """
    POST /api/host-applications/agreement/accept/ — record acceptance of the
    current agreement version. Used when an existing host must re-accept a newly
    published version before listing again.
    """
    agreements.record_acceptance(request.user, ip_address=_client_ip(request))
    return Response(_agreement_payload(request.user), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_host_application(request):
    """
    GET /api/host-applications/me/ — the current user's latest application.

    Returns 204 if the user has never applied, so the frontend can show the
    initial "apply" state. Otherwise returns the latest application with its
    status (pending / declined-with-reason / approved).
    """
    application = (
        HostApplication.objects.filter(applicant=request.user)
        .order_by('-created_at')
        .first()
    )
    if application is None:
        return Response(status=status.HTTP_204_NO_CONTENT)

    return Response(HostApplicationSerializer(application, context={'request': request}).data)


# ── Reviewer queue (superadmin KYC module) ──────────────────────────────────
# Reuses the exact same service functions / Django permissions Django admin
# already uses for this workflow — this is a second front door onto the same
# real review pipeline, not a parallel implementation of it.

STAGE_PERMISSION = {
    HostApplication.Stage.PRODUCT_SUPPORT: 'hostapplications.review_product_support',
    HostApplication.Stage.COMPLIANCE: 'hostapplications.review_compliance',
    HostApplication.Stage.SUPERVISOR: 'hostapplications.review_supervisor',
}
STAGE_STATUS = {
    HostApplication.Stage.PRODUCT_SUPPORT: HostApplication.Status.SUBMITTED,
    HostApplication.Stage.COMPLIANCE: HostApplication.Status.PS_APPROVED,
    HostApplication.Stage.SUPERVISOR: HostApplication.Status.COMPLIANCE_APPROVED,
}
STAGE_SERVICE_FN = {
    HostApplication.Stage.PRODUCT_SUPPORT: ps_decision,
    HostApplication.Stage.COMPLIANCE: compliance_decision,
    HostApplication.Stage.SUPERVISOR: supervisor_decision,
}


def _has_background_checks_access(user):
    """The trust_safety.background_checks RBAC resource — additive to the
    per-stage Django permissions below, not a replacement: a role granting
    it (e.g. the Trust & Safety Specialist preset) can review every stage,
    while the fine-grained Product Support / Compliance / Supervisor Officer
    groups still work exactly as before."""
    from rbac.permissions import has_permission
    return has_permission(user, 'trust_safety.background_checks', 'execute')


def reviewable_stages(user):
    if _has_background_checks_access(user):
        return list(STAGE_PERMISSION.keys())
    return [stage for stage, perm in STAGE_PERMISSION.items() if user.has_perm(perm)]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def review_queue(request):
    """GET /api/host-applications/review-queue/ — applications awaiting review
    at any stage the requesting officer has permission for."""
    stages = reviewable_stages(request.user)
    if not stages:
        return Response({'error': 'You are not a reviewer for any stage of this queue.'}, status=status.HTTP_403_FORBIDDEN)
    statuses = [STAGE_STATUS[s] for s in stages]
    qs = (
        HostApplication.objects.filter(status__in=statuses)
        .select_related('applicant')
        .order_by('created_at')
    )
    return Response(HostApplicationSerializer(qs, many=True, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def review_decision(request, pk):
    """POST /api/host-applications/<pk>/review/ — approve or decline at
    whichever stage this application is currently awaiting."""
    application = get_object_or_404(HostApplication, pk=pk)
    stage = application.current_stage
    if stage is None:
        return Response({'error': 'This application is not awaiting review.'}, status=status.HTTP_400_BAD_REQUEST)
    if not (_has_background_checks_access(request.user) or request.user.has_perm(STAGE_PERMISSION[stage])):
        return Response({'error': 'You are not authorized to review this stage.'}, status=status.HTTP_403_FORBIDDEN)

    approve = bool(request.data.get('approve'))
    reason = request.data.get('reason', '')
    if not approve and not str(reason).strip():
        return Response({'error': 'A reason is required when declining.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        STAGE_SERVICE_FN[stage](application, approve, request.user, reason)
    except InvalidTransition as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    from superadmin.permissions import log_admin_action
    log_admin_action(
        request, 'host_application.review', target=application, reason=reason,
        approved=approve, stage=stage,
    )
    return Response(HostApplicationSerializer(application, context={'request': request}).data)
