from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import PropertyVerification
from .serializers import (
    PropertyVerificationCreateSerializer,
    PropertyVerificationResubmitSerializer,
    PropertyVerificationSerializer,
    PropertyVerificationAdminSerializer,
)
from . import services
from .services import InvalidTransition


def _notify(fn_name, verification):
    try:
        from notifications import services as nsvc
        getattr(nsvc, fn_name)(verification)
    except Exception:
        pass  # never let notifications break the request


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def property_verifications_collection(request):
    """
    POST /api/property-verifications/ — submit a listing for verification.

    Called right after the listing is created in the wizard. Puts the listing
    into `pending_review` (hidden from public search) and starts the pipeline.
    """
    serializer = PropertyVerificationCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    verification = serializer.save(applicant=request.user)

    from aiscoring.tasks import score_property_verification_task
    score_property_verification_task.delay(verification.id)

    # Ensure the listing is unpublished while under review.
    listing = verification.listing
    if listing.status != 'pending_review':
        listing.status = 'pending_review'
        listing.save(update_fields=['status'])

    _notify('notify_property_verification_submitted', verification)  # → Product Support Officers
    _notify('notify_property_verification_received', verification)   # → host

    return Response(
        PropertyVerificationSerializer(verification, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def verification_for_listing(request, listing_id):
    """
    GET /api/property-verifications/for-listing/<listing_id>/ — the verification
    for one of the caller's listings (204 if none yet).
    """
    verification = (
        PropertyVerification.objects
        .select_related('listing')
        .filter(listing_id=listing_id, applicant=request.user)
        .first()
    )
    if verification is None:
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(PropertyVerificationSerializer(verification, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def resubmit_verification(request, pk):
    """
    POST /api/property-verifications/<pk>/resubmit/ — host resubmits after a
    correction request. Optionally updates the validation fields first.
    """
    verification = (
        PropertyVerification.objects.select_related('listing')
        .filter(pk=pk, applicant=request.user)
        .first()
    )
    if verification is None:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
    if verification.status != PropertyVerification.Status.CORRECTION_REQUESTED:
        return Response({'detail': 'This verification is not awaiting correction.'},
                        status=status.HTTP_400_BAD_REQUEST)

    serializer = PropertyVerificationResubmitSerializer(verification, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()

    services.resubmit(verification)
    from aiscoring.tasks import score_property_verification_task
    score_property_verification_task.delay(verification.id)
    return Response(PropertyVerificationSerializer(verification, context={'request': request}).data)


# ── Reviewer queue (superadmin KYC module) ──────────────────────────────────
# Same real pipeline Django admin already drives — this is a second front
# door onto it, not a parallel implementation.

STAGE_PERMISSION = {
    PropertyVerification.Stage.PRODUCT_SUPPORT: 'propertyverifications.review_property_product_support',
    PropertyVerification.Stage.COMPLIANCE: 'propertyverifications.review_property_compliance',
    PropertyVerification.Stage.SUPERVISOR: 'propertyverifications.review_property_supervisor',
}
STAGE_STATUS = {
    PropertyVerification.Stage.PRODUCT_SUPPORT: PropertyVerification.Status.SUBMITTED,
    PropertyVerification.Stage.COMPLIANCE: PropertyVerification.Status.PS_APPROVED,
    PropertyVerification.Stage.SUPERVISOR: PropertyVerification.Status.COMPLIANCE_APPROVED,
}
STAGE_SERVICE_FN = {
    PropertyVerification.Stage.PRODUCT_SUPPORT: services.ps_decision,
    PropertyVerification.Stage.COMPLIANCE: services.compliance_decision,
    PropertyVerification.Stage.SUPERVISOR: services.supervisor_decision,
}
VALID_DECISIONS = {services.APPROVE, services.REJECT, services.REQUEST_CORRECTION}


def _has_background_checks_access(user):
    """The trust_safety.background_checks RBAC resource — additive to the
    per-stage Django permissions below, not a replacement: a role granting
    it (e.g. the Trust & Safety Specialist preset) can review every stage,
    while the fine-grained Product Support / Compliance / Supervisor Officer
    groups still work exactly as before."""
    from rbac.permissions import has_permission
    return has_permission(user, 'trust_safety.background_checks', 'execute')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def review_queue(request):
    """GET /api/property-verifications/review-queue/ — verifications awaiting
    review at any stage the requesting officer has permission for."""
    if _has_background_checks_access(request.user):
        stages = list(STAGE_PERMISSION.keys())
    else:
        stages = [stage for stage, perm in STAGE_PERMISSION.items() if request.user.has_perm(perm)]
    if not stages:
        return Response({'error': 'You are not a reviewer for any stage of this queue.'}, status=status.HTTP_403_FORBIDDEN)
    statuses = [STAGE_STATUS[s] for s in stages]
    qs = (
        PropertyVerification.objects.filter(status__in=statuses)
        .select_related('listing', 'applicant')
        .order_by('created_at')
    )
    return Response(PropertyVerificationAdminSerializer(qs, many=True, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def review_decision(request, pk):
    """POST /api/property-verifications/<pk>/review/ — approve, reject, or
    request correction at whichever stage this verification is awaiting.

    At the Compliance stage, approving additionally accepts the site-visit
    record: due_diligence_done (bool), inspection_report (file),
    inspection_latitude/inspection_longitude (GPS coordinates)."""
    verification = get_object_or_404(PropertyVerification, pk=pk)
    stage = verification.current_stage
    if stage is None:
        return Response({'error': 'This verification is not awaiting review.'}, status=status.HTTP_400_BAD_REQUEST)
    if not (_has_background_checks_access(request.user) or request.user.has_perm(STAGE_PERMISSION[stage])):
        return Response({'error': 'You are not authorized to review this stage.'}, status=status.HTTP_403_FORBIDDEN)

    decision = request.data.get('decision')
    notes = request.data.get('notes', '')
    if decision not in VALID_DECISIONS:
        return Response({'error': f'decision must be one of {sorted(VALID_DECISIONS)}'}, status=status.HTTP_400_BAD_REQUEST)
    if decision != services.APPROVE and not str(notes).strip():
        return Response({'error': 'Notes are required when rejecting or requesting a correction.'}, status=status.HTTP_400_BAD_REQUEST)

    kwargs = {}
    if stage == PropertyVerification.Stage.COMPLIANCE:
        inspection_data = {}
        if 'due_diligence_done' in request.data:
            raw = request.data.get('due_diligence_done')
            inspection_data['due_diligence_done'] = str(raw).lower() in ('true', '1', 'yes')
        if 'inspection_report' in request.FILES:
            inspection_data['inspection_report'] = request.FILES['inspection_report']
        for field in ('inspection_latitude', 'inspection_longitude'):
            if request.data.get(field) not in (None, ''):
                try:
                    inspection_data[field] = float(request.data[field])
                except (TypeError, ValueError):
                    return Response({'error': f'{field} must be a number.'}, status=status.HTTP_400_BAD_REQUEST)
        kwargs['inspection_data'] = inspection_data

    try:
        STAGE_SERVICE_FN[stage](verification, decision, request.user, notes, **kwargs)
    except InvalidTransition as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    from superadmin.permissions import log_admin_action
    log_admin_action(
        request, 'property_verification.review', target=verification, reason=notes,
        decision=decision, stage=stage,
    )
    return Response(PropertyVerificationAdminSerializer(verification, context={'request': request}).data)
