from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Report
from .serializers import ReportCreateSerializer, ReportSerializer, ReportAdminUpdateSerializer


def _is_admin(user):
    return user.is_authenticated and (user.role == 'admin' or user.is_staff)


# ---------------------------------------------------------------------------
# User-facing endpoints
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def reports_collection(request):
    """
    GET  — list reports filed by the current user.
    POST — file a new report.
    """
    if request.method == 'GET':
        qs = Report.objects.filter(reporter=request.user).select_related(
            'reported_user', 'reported_listing', 'reported_review', 'resolved_by'
        )

        # Optional status filter
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        serializer = ReportSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    # POST
    serializer = ReportCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    report = serializer.save(reporter=request.user)

    # Notify all admins about the new report
    try:
        from notifications.services import notify_report_submitted
        notify_report_submitted(report)
    except Exception:
        pass  # Never let notification failure break the report submission

    return Response(ReportSerializer(report, context={'request': request}).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def report_detail(request, pk):
    """
    GET — retrieve a single report.
    Reporters can only see their own reports; admins can see any.
    """
    try:
        report = Report.objects.select_related(
            'reporter', 'reported_user', 'reported_listing',
            'reported_review', 'reported_message', 'resolved_by'
        ).get(pk=pk)
    except Report.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if report.reporter != request.user and not _is_admin(request.user):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    serializer = ReportSerializer(report, context={'request': request})
    return Response(serializer.data)


# ---------------------------------------------------------------------------
# Admin-only endpoints
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_reports_list(request):
    """
    GET — paginated list of all reports with optional filters.
    Admin only.
    """
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = Report.objects.select_related(
        'reporter', 'reported_user', 'reported_listing',
        'reported_review', 'reported_message', 'resolved_by'
    )

    # Filters
    filter_status = request.query_params.get('status')
    filter_type   = request.query_params.get('report_type')
    filter_ct     = request.query_params.get('content_type')

    if filter_status:
        qs = qs.filter(status=filter_status)
    if filter_type:
        qs = qs.filter(report_type=filter_type)
    if filter_ct:
        qs = qs.filter(content_type=filter_ct)

    # Simple offset pagination
    try:
        limit  = max(1, min(int(request.query_params.get('limit', 20)), 100))
        offset = max(0, int(request.query_params.get('offset', 0)))
    except (ValueError, TypeError):
        limit, offset = 20, 0

    total  = qs.count()
    page   = qs[offset: offset + limit]
    serializer = ReportSerializer(page, many=True, context={'request': request})

    return Response({
        'count':   total,
        'limit':   limit,
        'offset':  offset,
        'results': serializer.data,
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_update_report_status(request, pk):
    """
    PATCH — update a report's status and optionally add admin notes.
    Admin only.

    Body: { "status": "resolved" | "dismissed" | "under_review", "admin_notes": "..." }
    """
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        report = Report.objects.select_related('reporter').get(pk=pk)
    except Report.DoesNotExist:
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    serializer = ReportAdminUpdateSerializer(report, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    new_status = serializer.validated_data.get('status', report.status)
    notes      = serializer.validated_data.get('admin_notes', '')

    old_status = report.status

    if new_status == Report.Status.RESOLVED:
        report.resolve(request.user, notes)
    elif new_status == Report.Status.DISMISSED:
        report.dismiss(request.user, notes)
    elif new_status == Report.Status.UNDER_REVIEW:
        report.mark_under_review(request.user)
        if notes:
            report.admin_notes = notes
            report.save(update_fields=['admin_notes'])
    else:
        report.status = new_status
        report.save(update_fields=['status', 'updated_at'])

    # Notify the reporter that their report status changed (skip if no change)
    if new_status != old_status:
        try:
            from notifications.services import notify_report_updated
            notify_report_updated(report)
        except Exception:
            pass

    return Response(ReportSerializer(report, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_report_stats(request):
    """
    GET — summary counts by status for the admin dashboard.
    Admin only.
    """
    if not _is_admin(request.user):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    from django.db.models import Count

    counts = Report.objects.values('status').annotate(count=Count('id'))
    stats  = {item['status']: item['count'] for item in counts}

    return Response({
        'total':        Report.objects.count(),
        'pending':      stats.get(Report.Status.PENDING, 0),
        'under_review': stats.get(Report.Status.UNDER_REVIEW, 0),
        'resolved':     stats.get(Report.Status.RESOLVED, 0),
        'dismissed':    stats.get(Report.Status.DISMISSED, 0),
    })
