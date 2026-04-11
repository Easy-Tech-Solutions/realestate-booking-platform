from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import authenticate
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError
from .serializers import UserSerializer
from .throttles import LoginRateThrottle, RegisterRateThrottle, PasswordResetRateThrottle, VerifyEmailRateThrottle
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
User = get_user_model()


def _get_active_suspension(user):
    from suspensions.models import Suspension
    return (
        Suspension.objects
        .filter(user=user, status=Suspension.Status.ACTIVE)
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now()))
        .first()
    )


def _suspension_response(suspension):
    return {
        "error": "Your account has been suspended.",
        "code": "account_suspended",
        "reason": suspension.reason,
        "suspension_type": suspension.suspension_type,
        "ends_at": suspension.ends_at.isoformat() if suspension.ends_at else None,
    }

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([RegisterRateThrottle])
def register(request):
    username = request.data.get("username")
    email = request.data.get("email")
    password = request.data.get("password")
    password2 = request.data.get("password2")
    first_name = request.data.get("first_name")
    last_name = request.data.get("last_name")

    # Input validation
    if not all([username, password, email, password2]):
        return Response({"error": "username, email, password, and password2 required"}, status=status.HTTP_400_BAD_REQUEST)

    # Password confirmation check
    if password != password2:
        return Response({"error": "Passwords do not match"}, status=status.HTTP_400_BAD_REQUEST)

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
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name or "",
            last_name=last_name or "",
            is_active=not settings.AUTH_REQUIRE_EMAIL_VERIFICATION,
        )
        # Send verification email (pseudo-code)
        from . utils import send_verification_email
        send_verification_email(user)
        return Response({"message": "User registered successfully. Please check your email to verify your account."}, status=status.HTTP_201_CREATED)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([VerifyEmailRateThrottle])
def verify_email(request):
    token = request.data.get("token")
    if not token:
        return Response({"error": "Token is required"}, status=status.HTTP_400_BAD_REQUEST)

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
@throttle_classes([LoginRateThrottle])
def login_view(request):
    username = request.data.get("username")
    password = request.data.get("password")

    if not username or not password:
        return Response({"error": "username and password required"}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response({"error": "invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    if settings.AUTH_REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        return Response({"error": "Please verify your email before logging in. Check your email for the verification link."}, status=status.HTTP_403_FORBIDDEN)

    if not user.is_active:
        return Response({"error": "This account has been deactivated."}, status=status.HTTP_403_FORBIDDEN)

    # Check for an active suspension before issuing tokens
    suspension = _get_active_suspension(user)
    if suspension:
        return Response(_suspension_response(suspension), status=status.HTTP_403_FORBIDDEN)

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

        # Block suspended users from minting new access tokens
        user_id = refresh.get("user_id")
        if user_id:
            try:
                user = User.objects.get(pk=user_id)
                suspension = _get_active_suspension(user)
                if suspension:
                    return Response(_suspension_response(suspension), status=status.HTTP_403_FORBIDDEN)
            except User.DoesNotExist:
                pass

        access_token = str(refresh.access_token)
        return Response({"access": access_token, "access_token": access_token})
    except Exception:
        return Response({"error": "Invalid refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def password_reset_request(request):
    email = request.data.get("email")
    if not email:
        return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Return success regardless to avoid exposing whether an email exists
        return Response({"message": "If an account with that email exists, a password reset link has been sent."}, status=status.HTTP_200_OK)

    from .utils import send_password_reset_email
    send_password_reset_email(user)
    return Response({"message": "If an account with that email exists, a password reset link has been sent."}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def password_reset_confirm(request):
    token = request.data.get("token")
    password = request.data.get("password")
    password2 = request.data.get("password2")

    if not all([token, password, password2]):
        return Response({"error": "token, password, and password2 are required"}, status=status.HTTP_400_BAD_REQUEST)

    if password != password2:
        return Response({"error": "Passwords do not match"}, status=status.HTTP_400_BAD_REQUEST)

    if len(password) < 8:
        return Response({"error": "Password must be at least 8 characters long"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(password_reset_token=token)
    except User.DoesNotExist:
        return Response({"error": "Invalid or expired reset token"}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(password)
    user.password_reset_token = None
    user.save()
    return Response({"message": "Password reset successfully. You can now log in with your new password."}, status=status.HTTP_200_OK)
