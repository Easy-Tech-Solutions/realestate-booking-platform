from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError
from .serializers import UserSerializer
#from django_ratelimit.decorators import ratelimit
from django.contrib.auth import get_user_model
User = get_user_model()

@api_view(["POST"])
@permission_classes([AllowAny])
#@ratelimit(key="ip", rate="5/hour")  #Basic rate limiting to prevent abuse
def register(request):
    username = request.data.get("username")
    email = request.data.get("email")
    password = request.data.get("password")

    # Input validation
    if not all([username, password, email]):
        return Response({"error": "username, email, and password required"}, status=status.HTTP_400_BAD_REQUEST)
    
    # Email validation
    try:
        validate_email(email)
    except ValidationError:
        return Response({"error": "invalid email"}, status=status.HTTP_400_BAD_REQUEST)
    
    #Password strength check
    if len(password) < 8:
        return Response({"error": "password must be at least 8 characters long"}, status=status.HTTP_400_BAD_REQUEST)
    
    #Username and email availability check
    if User.objects.filter(username=username).exists():
        return Response({"error": "Username already exists"}, status=status.HTTP_400_BAD_REQUEST)
    
    if User.objects.filter(email=email).exists():
        return Response({"error": "Email already exists"}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        user = User.objects.create_user(username=username, email=email, password=password, is_active=False)  #User needs to verify email
        # Send verification email (pseudo-code)
        from . utils import send_verification_email
        send_verification_email(user)
        return Response({"message": "User registered successfully. Please check your email to verify your account."}, status=status.HTTP_201_CREATED)
    
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["GET"])
@permission_classes([AllowAny])
#Handles email verification
def verify_email(request, token):
    try:
        user = User.objects.get(email_verification_token=token)
        user.email_verified = True
        user.is_active = True
        user.email_verification_token = None
        user.save()
        return Response({"message": "Email verified successfully"}, status=status.HTTP_200_OK)
    except User.DoesNotExist:
        return Response({"error": "Invalid verification token"}, status=status.HTTP_400_BAD_REQUEST)

@api_view(["POST"])
@permission_classes([AllowAny])
#@ratelimit(key="ip", rate="5/minute")
#Handles Login functionality
def login_view(request):
    username = request.data.get("username")
    password = request.data.get("password")

    if not username or not password:
        return Response({"error": "username and password required"}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response({"error": "invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    # Temporarily disabled for testing
    if not user.email_verified:
        return Response({"error": "Please verify your email before logging in. Check your email for the verification link."}, status=status.HTTP_403_FORBIDDEN)

    if not user.is_active:
        return Response({"error": "This account has been deactivated."}, status=status.HTTP_403_FORBIDDEN)
    
    #Geneate JWT tokens
    refresh = RefreshToken.for_user(user)
    return Response({
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": UserSerializer(user).data
    })

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    try:
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            return Response({"error":"Refresh token is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Blacklist the refresh token
        token = RefreshToken(refresh_token)
        token.blacklist()
        
        return Response({"message": "Logged out successfully"}, status=status.HTTP_205_RESET_CONTENT)

    except TokenError as e:
        return Response({"error": "Invalid or expired token"}, status=status.HTTP_400_BAD_REQUEST)
    
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_token_view(request):
    refresh_token = request.data.get("refresh")
    if not refresh_token:
        return Response({"error": "Refresh token is required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        refresh = RefreshToken(refresh_token)
        access_token = str(refresh.access_token)
        return Response({"access_token": access_token})
    except Exception:
        return Response({"error": "Invalid refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)
