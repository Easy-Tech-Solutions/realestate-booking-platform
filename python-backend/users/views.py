from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.contrib.auth.models import User
from .serializers import PublicUserSerializer

@api_view(["GET"])
@permission_classes([AllowAny])
def users_collection(request):
    items = User.objects.all().order_by("id")
    return Response(PublicUserSerializer(items, many=True).data)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_detail(request, id):
    try:
        u = User.objects.get(pk=id)
    except User.DoesNotExist:
        return Response({"error": "not found"}, status=404)
    return Response(PublicUserSerializer(u).data)
