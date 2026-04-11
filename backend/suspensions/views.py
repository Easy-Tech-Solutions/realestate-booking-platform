from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Suspension
from .serializers import (
    SuspensionCreateSerializer,
    SuspensionSerializer,
    SuspensionRevokeSerializer,
)


def _is_admin(user):
    return user.is_authenticated and (getattr(user, 'role', None) == 'admin' or user.is_staff)



# Collection  — POST to create, GET to list all

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def suspensions_collection(request):
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        qs = Suspension.objects.select_related(
            'user', 'issued_by', 'revoked_by', 'related_report'
        )

        # Filters
        filter_status = request.query_params.get('status')
        filter_type   = request.query_params.get('suspension_type')
        user_id       = request.query_params.get('user_id')

        if filter_status:
            qs = qs.filter(status=filter_status)
        if filter_type:
            qs = qs.filter(suspension_type=filter_type)
        if user_id:
            qs = qs.filter(user_id=user_id)

        # Offset pagination
        try:
            limit  = max(1, min(int(request.query_params.get('limit', 20)), 100))
            offset = max(0, int(request.query_params.get('offset', 0)))
        except (ValueError, TypeError):
            limit, offset = 20, 0

        total = qs.count()
        page  = qs[offset: offset + limit]
        serializer = SuspensionSerializer(page, many=True)
        return Response({'count': total, 'limit': limit, 'offset': offset, 'results': serializer.data})

    # POST — create a new suspension
    serializer = SuspensionCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    suspension = serializer.save(issued_by=request.user)

    # Trigger notification (signal handles this, but we fire it here as well as a
    # safety net in case the signal connection isn't active in tests)
    try:
        from notifications.services import notify_account_suspended
        notify_account_suspended(suspension)
        suspension.user_notified = True
        suspension.save(update_fields=['user_notified'])
    except Exception:
        pass

    return Response(
        SuspensionSerializer(suspension).data,
        status=status.HTTP_201_CREATED,
    )



# Detail

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def suspension_detail(request, pk):
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        suspension = Suspension.objects.select_related(
            'user', 'issued_by', 'revoked_by', 'related_report'
        ).get(pk=pk)
    except Suspension.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    return Response(SuspensionSerializer(suspension).data)



# Revoke a suspension early

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def revoke_suspension(request, pk):
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        suspension = Suspension.objects.select_related('user').get(pk=pk)
    except Suspension.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not suspension.is_currently_active:
        return Response(
            {'detail': 'This suspension is not active and cannot be revoked.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = SuspensionRevokeSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    suspension.revoke(
        admin_user=request.user,
        reason=serializer.validated_data.get('revocation_reason', ''),
    )

    # Notify the user their suspension was lifted
    try:
        from notifications.services import notify_account_reinstated
        notify_account_reinstated(suspension)
    except Exception:
        pass

    return Response(SuspensionSerializer(suspension).data)



# Suspension history for a specific user

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_suspension_history(request, user_id):
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = Suspension.objects.filter(user_id=user_id).select_related(
        'user', 'issued_by', 'revoked_by', 'related_report'
    )

    # Annotate whether the user is currently suspended
    now = timezone.now()
    currently_suspended = qs.filter(
        status=Suspension.Status.ACTIVE,
    ).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=now)
    ).exists()

    serializer = SuspensionSerializer(qs, many=True)
    return Response({
        'user_id':             user_id,
        'currently_suspended': currently_suspended,
        'total':               qs.count(),
        'suspensions':         serializer.data,
    })



# Admin stats

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def suspension_stats(request):
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    counts = Suspension.objects.values('status').annotate(count=Count('id'))
    by_status = {item['status']: item['count'] for item in counts}

    by_type = Suspension.objects.values('suspension_type').annotate(count=Count('id'))
    by_type_map = {item['suspension_type']: item['count'] for item in by_type}

    now = timezone.now()
    active_now = Suspension.objects.filter(
        status=Suspension.Status.ACTIVE,
    ).filter(
        Q(ends_at__isnull=True) | Q(ends_at__gt=now)
    ).count()

    return Response({
        'total':               Suspension.objects.count(),
        'currently_active':    active_now,
        'by_status': {
            'active':  by_status.get('active',  0),
            'expired': by_status.get('expired', 0),
            'revoked': by_status.get('revoked', 0),
        },
        'by_type': {
            'temporary':  by_type_map.get('temporary',  0),
            'indefinite': by_type_map.get('indefinite', 0),
            'permanent':  by_type_map.get('permanent',  0),
        },
    })
