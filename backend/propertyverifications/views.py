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
)
from . import services


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
    return Response(PropertyVerificationSerializer(verification, context={'request': request}).data)
