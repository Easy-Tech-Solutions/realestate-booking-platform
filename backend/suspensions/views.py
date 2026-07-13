from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from rbac import dual_auth

from .models import Suspension
from .serializers import (
    SuspensionCreateSerializer,
    SuspensionSerializer,
    SuspensionRevokeSerializer,
)

# Suspending a host with more than this many live listings requires a second
# admin's sign-off (dual authorization) — scaled to this platform's actual
# size, not the ">100 listings" figure from a marketplace at Airbnb's scale.
DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD = 3


@dual_auth.register_executor('user.suspend')
def _execute_user_suspend(payload):
    from django.contrib.auth import get_user_model
    User = get_user_model()

    target_user = User.objects.get(pk=payload['user_id'])
    issued_by = User.objects.get(pk=payload['issued_by_id'])

    already_active = (
        Suspension.objects.filter(user=target_user, status=Suspension.Status.ACTIVE)
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now()))
        .exists()
    )
    if already_active:
        raise RuntimeError(f'{target_user.username} already has an active suspension — refresh and check before re-approving.')

    ends_at = payload.get('ends_at')
    if ends_at:
        from django.utils.dateparse import parse_datetime
        ends_at = parse_datetime(ends_at)

    related_report = None
    if payload.get('related_report_id'):
        from reports.models import Report
        related_report = Report.objects.filter(pk=payload['related_report_id']).first()

    suspension = Suspension.objects.create(
        user=target_user, issued_by=issued_by, suspension_type=payload['suspension_type'],
        reason=payload['reason'], ends_at=ends_at, related_report=related_report,
    )
    try:
        from notifications.services import notify_account_suspended
        notify_account_suspended(suspension)
        suspension.user_notified = True
        suspension.save(update_fields=['user_notified'])
    except Exception:
        pass

    return {'suspension_id': suspension.id, 'user': target_user.username}


def _is_admin(request):
    """Full admins always pass; is_staff accounts need the support or
    trust_safety department (legacy) OR a custom role granting
    trust_safety.bans directly (Suspension is that resource) — suspensions
    can originate from either a resolved dispute or a confirmed fraud flag.
    Being merely is_staff (e.g. a KYC reviewer in an unrelated department)
    is not enough."""
    from superadmin.permissions import is_superadmin_staff, require_department
    from rbac.permissions import has_any_permission
    user = request.user
    if not is_superadmin_staff(user):
        return False
    return (
        require_department(user, 'support') or require_department(user, 'trust_safety')
        or has_any_permission(user, 'trust_safety.bans')
    )



# Collection  — POST to create, GET to list all

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def suspensions_collection(request):
    if not _is_admin(request):
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

    target_user = serializer.validated_data['user']
    from listings.models import Listing
    published_listing_count = Listing.objects.filter(
        owner=target_user, status='published', deleted_at__isnull=True,
    ).count()
    requires_dual_auth = published_listing_count > DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD

    if requires_dual_auth:
        related_report = serializer.validated_data.get('related_report')
        ends_at = serializer.validated_data.get('ends_at')
        reason = serializer.validated_data['reason']
        payload = {
            'user_id': target_user.id,
            'suspension_type': serializer.validated_data['suspension_type'],
            'reason': reason,
            'ends_at': ends_at.isoformat() if ends_at else None,
            'related_report_id': related_report.id if related_report else None,
            'issued_by_id': request.user.id,
        }
        _, approval = dual_auth.submit_or_execute('user.suspend', payload, request.user, reason, True)

        from superadmin.permissions import log_admin_action
        log_admin_action(request, 'suspension.requested', target=target_user, reason=reason, approval_id=approval.id, listing_count=published_listing_count)

        return Response(
            {
                'pending_approval': True, 'approval_id': approval.id,
                'message': f'{target_user.username} owns {published_listing_count} published listings (above the {DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD} threshold) — this suspension requires a second admin to approve it before it takes effect.',
            },
            status=status.HTTP_202_ACCEPTED,
        )

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
    if not _is_admin(request):
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
    if not _is_admin(request):
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
    if not _is_admin(request):
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
    if not _is_admin(request):
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
