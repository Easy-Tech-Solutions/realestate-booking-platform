from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import AgentApplication, AGENT_AGREEMENT_VERSION, is_approved_agent
from .serializers import AgentApplicationCreateSerializer, AgentApplicationSerializer


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def agent_applications_collection(request):
    """POST /api/agent-applications/ — apply to become a sourcing agent."""
    serializer = AgentApplicationCreateSerializer(data=request.data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    application = serializer.save(
        applicant=request.user,
        agreement_version=AGENT_AGREEMENT_VERSION,
        agreement_accepted_at=timezone.now(),
    )

    try:
        from notifications.services import (
            notify_agent_application_submitted, notify_agent_application_received,
        )
        notify_agent_application_submitted(application)  # → reviewers
        notify_agent_application_received(application)    # → applicant
    except Exception:
        pass

    return Response(
        AgentApplicationSerializer(application, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_agent_application(request):
    """
    GET /api/agent-applications/me/ — the user's latest application + whether
    they're already an approved agent. 200 always (fields tell the frontend
    which state to render).
    """
    application = (
        AgentApplication.objects.filter(applicant=request.user).order_by('-created_at').first()
    )
    payload = {'is_agent': is_approved_agent(request.user), 'application': None}
    if application is not None:
        payload['application'] = AgentApplicationSerializer(application, context={'request': request}).data
    return Response(payload)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def agent_dashboard(request):
    """
    GET /api/agents/dashboard/ — read-only summary for the sourcing agent:
    properties sourced (+ statuses), bookings generated, and commissions.
    """
    from decimal import Decimal
    from listings.models import Listing
    from bookings.models import Booking
    from .models import AgentCommission

    user = request.user
    listings = (
        Listing.objects.filter(sourced_by_agent=user)
        .select_related('verification').order_by('-created_at')
    )
    sourced = [{
        'id': l.id,
        'title': l.title,
        'listing_status': l.status,
        'verification_status': getattr(getattr(l, 'verification', None), 'status', None),
        'created_at': l.created_at.isoformat(),
    } for l in listings]

    commissions_qs = AgentCommission.objects.filter(agent=user).select_related('listing').order_by('-created_at')
    def _sum(status):
        return sum((c.amount for c in commissions_qs if c.status == status), Decimal('0'))
    pending, paid = _sum('pending'), _sum('paid')

    commissions = [{
        'id': c.id, 'booking_id': c.booking_id,
        'listing_title': c.listing.title if c.listing else None,
        'amount': f'{c.amount:.2f}', 'currency': c.currency,
        'status': c.status, 'created_at': c.created_at.isoformat(),
    } for c in commissions_qs[:50]]

    bookings_count = Booking.objects.filter(listing__sourced_by_agent=user).count()

    return Response({
        'is_agent': is_approved_agent(user),
        'summary': {
            'properties_sourced': listings.count(),
            'published': listings.filter(status='published').count(),
            'in_review': listings.filter(status='pending_review').count(),
            'total_bookings': bookings_count,
            'commission_pending': f'{pending:.2f}',
            'commission_paid': f'{paid:.2f}',
            'commission_total': f'{(pending + paid):.2f}',
        },
        'sourced_properties': sourced,
        'commissions': commissions,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def agent_list_property(request):
    """
    POST /api/agents/list-property/ — an approved agent submits a property on an
    owner's behalf.

    Creates the Listing owned by the Home Konet Operations account (so inquiries
    route to Ops, not the agent), records the agent as `sourced_by_agent` and the
    owner's contact + payout details, and opens a PropertyVerification
    (ownership_type='agent') into the standard review pipeline.
    """
    if not is_approved_agent(request.user):
        return Response({'error': 'You must be an approved agent to source properties.'},
                        status=status.HTTP_403_FORBIDDEN)

    # Owner details the agent captured in the field.
    owner_name          = (request.data.get('owner_name') or '').strip()
    owner_phone         = (request.data.get('owner_phone') or '').strip()
    owner_payout_number = (request.data.get('owner_payout_number') or '').strip()
    owner_consent       = str(request.data.get('owner_consent', '')).lower() in ('true', '1', 'yes', 'on')
    errors = {}
    if not owner_name:          errors['owner_name'] = 'Property owner name is required.'
    if not owner_phone:         errors['owner_phone'] = "Owner's phone number is required."
    if not owner_payout_number: errors['owner_payout_number'] = "Owner's payout (MoMo) number is required."
    if not owner_consent:       errors['owner_consent'] = 'You must attest that the owner consented to this listing.'
    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    from listings.serializers import ListingSerializer
    serializer = ListingSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    from .ops import get_ops_account
    ops = get_ops_account()
    listing = serializer.save(owner=ops, status='pending_review', is_available=False)
    listing.sourced_by_agent = request.user
    listing.agent_owner_name = owner_name
    listing.agent_owner_phone = owner_phone
    listing.agent_owner_email = (request.data.get('owner_email') or '').strip()
    listing.agent_owner_payout_number = owner_payout_number
    listing.agent_owner_payout_network = (request.data.get('owner_payout_network') or '').strip()
    listing.save(update_fields=[
        'sourced_by_agent', 'agent_owner_name', 'agent_owner_phone', 'agent_owner_email',
        'agent_owner_payout_number', 'agent_owner_payout_network',
    ])

    # Gallery photos (main_image is handled by the serializer). Done here so the
    # agent never needs write access to the Ops-owned listing's image endpoints.
    gallery = request.FILES.getlist('gallery_images')
    if gallery:
        from listings.models import ListingImage
        for i, img in enumerate(gallery[:10]):
            ListingImage.objects.create(listing=listing, image=img, order=i)

    from propertyverifications.models import PropertyVerification
    verification = PropertyVerification.objects.create(
        listing=listing, applicant=request.user,
        ownership_type=PropertyVerification.OwnershipType.AGENT,
        owner_name=owner_name,
        property_location=listing.address or (request.data.get('property_location') or ''),
        deed_volume_number=(request.data.get('deed_volume_number') or ''),
    )

    try:
        from aiscoring.tasks import score_property_verification_task
        score_property_verification_task.delay(verification.id)
    except Exception:
        pass
    try:
        from notifications import services as nsvc
        nsvc.notify_property_verification_submitted(verification)  # → reviewers
        nsvc.notify_property_verification_received(verification)    # → the agent
    except Exception:
        pass

    from propertyverifications.serializers import PropertyVerificationSerializer
    return Response(
        PropertyVerificationSerializer(verification, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )
