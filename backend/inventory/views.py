from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from listings.models import Listing
from superadmin.permissions import is_superadmin_staff, log_admin_action, require_department
from . import detection
from .models import ListingFlag
from .serializers import InventoryListingSerializer, ListingFlagSerializer


def _require_inventory(request):
    """Full admins always pass; is_staff accounts need the inventory
    department (legacy) OR a custom role granting listings.availability or
    trust_safety.flags directly (this app's ListingFlag model is the
    listing-moderation half of that resource)."""
    if not is_superadmin_staff(request.user):
        return False
    from rbac.permissions import has_any_permission
    user = request.user
    return (
        require_department(user, 'inventory')
        or has_any_permission(user, 'listings.availability') or has_any_permission(user, 'trust_safety.flags')
    )


class _InventoryPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def inventory_listing_list(request):
    """Global inventory search — every listing regardless of status, for
    moderation. The public /api/listings/ endpoint only ever shows published,
    available listings, so this is the first place staff can search drafts,
    pending-review, rejected, and suspended listings all together."""
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)

    qs = Listing.objects.select_related('owner', 'suspended_by').annotate(
        open_flag_count=Count('moderation_flags', filter=Q(moderation_flags__status=ListingFlag.Status.OPEN)),
    ).order_by('-created_at')

    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(title__icontains=search) | Q(address__icontains=search) | Q(city__icontains=search)
            | Q(owner__username__icontains=search) | Q(owner__email__icontains=search)
        )

    flagged_only = request.query_params.get('flagged') == 'true'
    if flagged_only:
        qs = qs.filter(open_flag_count__gt=0)

    paginator = _InventoryPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(InventoryListingSerializer(page, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_suspend(request, pk):
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to suspend a listing.'}, status=status.HTTP_400_BAD_REQUEST)
    listing = get_object_or_404(Listing, pk=pk)
    listing.status = 'suspended'
    listing.suspended_by = request.user
    listing.suspended_at = timezone.now()
    listing.suspension_reason = reason
    listing.save(update_fields=['status', 'suspended_by', 'suspended_at', 'suspension_reason', 'updated_at'])
    log_admin_action(request, 'listing.suspend', target=listing, reason=reason)
    return Response(InventoryListingSerializer(listing).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_unsuspend(request, pk):
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    listing = get_object_or_404(Listing, pk=pk)
    if listing.status != 'suspended':
        return Response({'error': 'Listing is not currently suspended.'}, status=status.HTTP_400_BAD_REQUEST)
    listing.status = 'published'
    listing.save(update_fields=['status', 'updated_at'])
    log_admin_action(request, 'listing.unsuspend', target=listing)
    return Response(InventoryListingSerializer(listing).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def listing_flags_list(request):
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    qs = ListingFlag.objects.select_related('listing', 'reviewed_by').all()
    status_filter = request.query_params.get('status', ListingFlag.Status.OPEN)
    if status_filter and status_filter != 'all':
        qs = qs.filter(status=status_filter)
    return Response(ListingFlagSerializer(qs, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_flags_scan(request):
    """Manually trigger the rule-based detectors. (A natural next step is
    scheduling this via Celery beat instead of an on-demand button.)"""
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    results = detection.run_all_detectors()
    created_count = sum(len(v) for v in results.values())
    log_admin_action(request, 'listing_flag.scan', reason='', created=created_count)
    return Response({
        'created': created_count,
        'by_detector': {k: len(v) for k, v in results.items()},
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_flag_create_manual(request):
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    listing_id = request.data.get('listing')
    details = str(request.data.get('details', '')).strip()
    severity = request.data.get('severity', ListingFlag.Severity.MEDIUM)
    if not listing_id or not details:
        return Response({'error': 'listing and details are required'}, status=status.HTTP_400_BAD_REQUEST)
    listing = get_object_or_404(Listing, pk=listing_id)
    flag = ListingFlag.objects.create(
        listing=listing, flag_type=ListingFlag.FlagType.MANUAL, severity=severity, details=details,
    )
    from aiscoring.tasks import score_listing_flag_task
    score_listing_flag_task.delay(flag.id)
    log_admin_action(request, 'listing_flag.create', target=flag, reason=details)
    return Response(ListingFlagSerializer(flag).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_flag_review(request, pk):
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)
    flag = get_object_or_404(ListingFlag, pk=pk)
    decision = request.data.get('status')
    if decision not in (ListingFlag.Status.DISMISSED, ListingFlag.Status.CONFIRMED):
        return Response({'error': 'status must be "dismissed" or "confirmed"'}, status=status.HTTP_400_BAD_REQUEST)
    notes = request.data.get('notes', '')
    flag.status = decision
    flag.review_notes = notes
    flag.reviewed_by = request.user
    flag.reviewed_at = timezone.now()
    flag.save(update_fields=['status', 'review_notes', 'reviewed_by', 'reviewed_at'])
    log_admin_action(request, 'listing_flag.review', target=flag, reason=notes, decision=decision)
    return Response(ListingFlagSerializer(flag).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def listing_bulk_action(request):
    """Apply suspend/unsuspend across many listings at once."""
    if not _require_inventory(request):
        return Response({'error': 'Inventory & Listings access required'}, status=status.HTTP_403_FORBIDDEN)

    action = request.data.get('action')
    listing_ids = request.data.get('listing_ids') or []
    reason = str(request.data.get('reason', '')).strip()

    if action not in ('suspend', 'unsuspend'):
        return Response({'error': 'action must be "suspend" or "unsuspend".'}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(listing_ids, list) or not listing_ids:
        return Response({'error': 'listing_ids (non-empty list) is required.'}, status=status.HTTP_400_BAD_REQUEST)
    if action == 'suspend' and not reason:
        return Response({'error': 'A reason is required to suspend listings.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(listing_ids) > 200:
        return Response({'error': 'Bulk actions are capped at 200 listings per request.'}, status=status.HTTP_400_BAD_REQUEST)

    results = {'succeeded': [], 'failed': []}
    listings = Listing.objects.filter(pk__in=listing_ids)
    found_ids = {l.pk for l in listings}
    for missing in set(listing_ids) - found_ids:
        results['failed'].append({'listing_id': missing, 'error': 'Not found'})

    for listing in listings:
        try:
            if action == 'suspend':
                listing.status = 'suspended'
                listing.suspended_by = request.user
                listing.suspended_at = timezone.now()
                listing.suspension_reason = reason
                listing.save(update_fields=['status', 'suspended_by', 'suspended_at', 'suspension_reason', 'updated_at'])
            else:
                if listing.status != 'suspended':
                    raise ValueError('Not currently suspended.')
                listing.status = 'published'
                listing.save(update_fields=['status', 'updated_at'])
            results['succeeded'].append(listing.pk)
        except Exception as e:
            results['failed'].append({'listing_id': listing.pk, 'error': str(e)})

    log_admin_action(
        request, f'listing.bulk_{action}', reason=reason, listing_ids=listing_ids,
        succeeded=results['succeeded'], failed=[f['listing_id'] for f in results['failed']],
    )
    return Response(results)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def listing_compliance(request, pk):
    """PATCH /api/inventory/listings/<pk>/compliance/ — set a listing's local
    registration number and/or legal occupancy cap. Gated by the
    listings.compliance RBAC resource specifically (not the broader
    inventory department bypass) since it's a distinct, narrower
    responsibility from day-to-day listing moderation."""
    from rbac.permissions import has_permission
    if not has_permission(request.user, 'listings.compliance', 'update'):
        return Response({'error': 'listings.compliance access required'}, status=status.HTTP_403_FORBIDDEN)

    listing = get_object_or_404(Listing, pk=pk)

    if 'local_registration_number' in request.data:
        listing.local_registration_number = str(request.data['local_registration_number']).strip()
    if 'occupancy_cap' in request.data:
        raw = request.data['occupancy_cap']
        listing.occupancy_cap = int(raw) if raw not in (None, '') else None
        if listing.occupancy_cap is not None and listing.max_guests > listing.occupancy_cap:
            return Response(
                {'error': f'This listing currently allows {listing.max_guests} guests, above the proposed cap of {listing.occupancy_cap}. Lower max_guests first (as the host) or raise the cap.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    listing.save(update_fields=['local_registration_number', 'occupancy_cap', 'updated_at'])
    log_admin_action(
        request, 'listing.compliance_update', target=listing,
        local_registration_number=listing.local_registration_number, occupancy_cap=listing.occupancy_cap,
    )
    return Response(InventoryListingSerializer(listing).data)
