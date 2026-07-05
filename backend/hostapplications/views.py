from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import HostApplication
from .serializers import HostApplicationCreateSerializer, HostApplicationSerializer


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

    # Notify the Product Support Officers that a new application is waiting.
    try:
        from notifications.services import notify_host_application_submitted
        notify_host_application_submitted(application)
    except Exception:
        pass  # Never let a notification failure break the submission.

    return Response(
        HostApplicationSerializer(application, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


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
