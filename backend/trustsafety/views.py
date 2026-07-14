from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from superadmin.permissions import is_superadmin_staff, log_admin_action, require_department
from . import detection
from .models import BlacklistedLocation, BlockedFingerprint, FraudFlag
from .serializers import BlacklistedLocationSerializer, BlockedFingerprintSerializer, FraudFlagSerializer

User = get_user_model()


def _require_trust_safety(request):
    """Full admins (superadmin) always pass; is_staff accounts need the
    trust_safety department (legacy) OR a custom role granting
    trust_safety.flags/bans directly — the department shim alone only
    recognizes a role literally slugged 'trust_safety', which a custom role
    built in the role editor would not be. require_department() already
    bypasses fully for is_full_admin() users, so no separate check is
    needed here for that."""
    if not is_superadmin_staff(request.user):
        return False
    from rbac.permissions import has_any_permission
    user = request.user
    return (
        require_department(user, 'trust_safety')
        or has_any_permission(user, 'trust_safety.flags') or has_any_permission(user, 'trust_safety.bans')
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def fraud_flags_list(request):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    qs = FraudFlag.objects.select_related('user', 'reviewed_by').all()
    status_filter = request.query_params.get('status', FraudFlag.Status.OPEN)
    if status_filter and status_filter != 'all':
        qs = qs.filter(status=status_filter)
    return Response(FraudFlagSerializer(qs, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def fraud_flags_scan(request):
    """Manually trigger the rule-based detectors. (A natural next step is
    scheduling this via Celery beat instead of an on-demand button.)"""
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    results = detection.run_all_detectors()
    created_count = sum(len(v) for v in results.values())
    log_admin_action(request, 'fraud_flag.scan', reason='', created=created_count)
    return Response({
        'created': created_count,
        'by_detector': {k: len(v) for k, v in results.items()},
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def fraud_flag_create_manual(request):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    user_id = request.data.get('user')
    details = str(request.data.get('details', '')).strip()
    severity = request.data.get('severity', FraudFlag.Severity.MEDIUM)
    if not user_id or not details:
        return Response({'error': 'user and details are required'}, status=status.HTTP_400_BAD_REQUEST)
    target_user = get_object_or_404(User, pk=user_id)
    flag = FraudFlag.objects.create(
        user=target_user, flag_type=FraudFlag.FlagType.MANUAL, severity=severity, details=details,
    )
    from aiscoring.tasks import score_fraud_flag_task
    score_fraud_flag_task.delay(flag.id)
    log_admin_action(request, 'fraud_flag.create', target=flag, reason=details)
    return Response(FraudFlagSerializer(flag).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def fraud_flag_review(request, pk):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    flag = get_object_or_404(FraudFlag, pk=pk)
    decision = request.data.get('status')
    if decision not in (FraudFlag.Status.DISMISSED, FraudFlag.Status.CONFIRMED):
        return Response({'error': 'status must be "dismissed" or "confirmed"'}, status=status.HTTP_400_BAD_REQUEST)
    notes = request.data.get('notes', '')
    flag.status = decision
    flag.review_notes = notes
    flag.reviewed_by = request.user
    flag.reviewed_at = timezone.now()
    flag.save(update_fields=['status', 'review_notes', 'reviewed_by', 'reviewed_at'])
    log_admin_action(request, 'fraud_flag.review', target=flag, reason=notes, decision=decision)
    return Response(FraudFlagSerializer(flag).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def blocked_fingerprints(request):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        qs = BlockedFingerprint.objects.select_related('blocked_by').all()
        return Response(BlockedFingerprintSerializer(qs, many=True).data)

    serializer = BlockedFingerprintSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    obj = serializer.save(blocked_by=request.user)
    log_admin_action(request, 'fingerprint.block', target=obj, reason=obj.reason)
    return Response(BlockedFingerprintSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def blocked_fingerprint_detail(request, pk):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    obj = get_object_or_404(BlockedFingerprint, pk=pk)
    log_admin_action(request, 'fingerprint.unblock', target=obj)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def blacklisted_locations(request):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        qs = BlacklistedLocation.objects.select_related('created_by').all()
        return Response(BlacklistedLocationSerializer(qs, many=True).data)

    serializer = BlacklistedLocationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    obj = serializer.save(created_by=request.user)
    log_admin_action(request, 'location.blacklist', target=obj, reason=obj.reason)
    return Response(BlacklistedLocationSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def blacklisted_location_detail(request, pk):
    if not _require_trust_safety(request):
        return Response({'error': 'Trust & Safety access required'}, status=status.HTTP_403_FORBIDDEN)
    obj = get_object_or_404(BlacklistedLocation, pk=pk)
    log_admin_action(request, 'location.unblacklist', target=obj)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
