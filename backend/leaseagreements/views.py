from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from bookings.models import Booking
from . import agreements
from .models import LeaseAgreement
from .serializers import LeaseAgreementSerializer


def _client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _can_view(user, booking):
    """The tenant and the property owner may both view the lease."""
    return user.id in (booking.customer_id, booking.listing.owner_id)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def lease_for_booking(request, booking_id):
    """
    GET /api/lease-agreements/for-booking/<booking_id>/ — the lease for a
    booking. Accessible to the tenant and the property owner. 204 if none.
    """
    booking = get_object_or_404(Booking.objects.select_related('listing'), pk=booking_id)
    if not _can_view(request.user, booking):
        return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    lease = LeaseAgreement.objects.filter(booking=booking).first()
    if lease is None:
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(LeaseAgreementSerializer(lease, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_lease(request, booking_id):
    """
    POST /api/lease-agreements/<booking_id>/accept/ — the tenant records their
    acceptance of the Agreement of Lease (before payment). Re-stamps the PDF.
    """
    booking = get_object_or_404(Booking.objects.select_related('listing'), pk=booking_id)
    if request.user.id != booking.customer_id:
        return Response({'detail': 'Only the guest can accept the lease.'},
                        status=status.HTTP_403_FORBIDDEN)
    if not agreements.is_long_term(booking.listing):
        return Response({'detail': 'This reservation has no lease agreement.'},
                        status=status.HTTP_400_BAD_REQUEST)

    agreements.record_acceptance(booking, request.user, ip_address=_client_ip(request))
    lease = LeaseAgreement.objects.filter(booking=booking).first()
    return Response(
        LeaseAgreementSerializer(lease, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )
