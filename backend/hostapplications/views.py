from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import HostApplication
from .serializers import HostApplicationCreateSerializer, HostApplicationSerializer
from . import agreements


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
