import logging
import re
import secrets

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
from .throttles import (
    LoginRateThrottle,
    RegisterRateThrottle,
    PasswordResetRateThrottle,
    VerifyEmailRateThrottle,
    GoogleLoginRateThrottle,
)
from .models import SocialAccount
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from django.conf import settings
from django.http import HttpResponse
from django.db import transaction
User = get_user_model()

logger = logging.getLogger(__name__)


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
        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                first_name=first_name or "",
                last_name=last_name or "",
                is_active=not settings.AUTH_REQUIRE_EMAIL_VERIFICATION,
            )
            if settings.AUTH_REQUIRE_EMAIL_VERIFICATION:
                from .utils import send_verification_email
                send_verification_email(user)
        message = "User registered successfully. Please check your email to verify your account."
        if not settings.AUTH_REQUIRE_EMAIL_VERIFICATION:
            message = "User registered successfully. You can now log in."
        return Response({"message": message}, status=status.HTTP_201_CREATED)
    except Exception:
        return Response(
            {"error": "Registration could not be completed because the verification email could not be sent. Please try again in a moment."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
@throttle_classes([VerifyEmailRateThrottle])
def verify_email(request):
    token = request.data.get("token") if request.method == "POST" else request.query_params.get("token")
    if not token:
        return Response({"error": "Token is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email_verification_token=token)
        user.email_verified = True
        user.is_active = True
        user.email_verification_token = None
        user.save()
        if request.method == "GET":
            login_url = getattr(settings, "FRONTEND_ORIGIN", "") or f"https://{settings.LOCAL_DOMAIN}"
            return HttpResponse(
                f"<html><body style='font-family: sans-serif; padding: 2rem;'><h1>Email verified</h1><p>Your account is now active. You can return to the app and log in.</p><p><a href='{login_url}'>Open app</a></p></body></html>"
            )
        return Response({"message": "Email verified successfully"}, status=status.HTTP_200_OK)
    except User.DoesNotExist:
        if request.method == "GET":
            return HttpResponse(
                "<html><body style='font-family: sans-serif; padding: 2rem;'><h1>Invalid verification link</h1><p>This verification link is invalid or has already been used.</p></body></html>",
                status=400,
            )
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


GOOGLE_ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_SIGNUP_ALLOWED_ROLES = {"user", "agent"}


def _verify_google_id_token(token):
    """Return the decoded Google ID-token payload, or None if invalid.

    Validates signature, expiry, audience, and issuer. Returns None on any
    failure so the caller can respond with a generic 401 (no detail leaked
    to the client). The actual reason is logged server-side so operators
    can distinguish misconfiguration from bad input.
    """
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        logger.error(
            "google_login: GOOGLE_OAUTH_CLIENT_ID is not configured; "
            "every Google sign-in will fail until it is set."
        )
        return None

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
    except ImportError:
        logger.error(
            "google_login: 'google-auth' package is not installed. "
            "Run `pip install -r requirements.txt`."
        )
        return None

    try:
        payload = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), client_id
        )
    except ValueError as exc:
        # google-auth raises ValueError for signature / expiry / audience
        # mismatches. The message is safe to log but not to return.
        logger.warning("google_login: token verification failed: %s", exc)
        return None
    except Exception:
        logger.exception("google_login: unexpected error verifying token")
        return None

    if payload.get("iss") not in GOOGLE_ALLOWED_ISSUERS:
        logger.warning("google_login: rejected token with iss=%r", payload.get("iss"))
        return None
    if not payload.get("email") or not payload.get("sub"):
        logger.warning("google_login: token missing email or sub claim")
        return None
    if not payload.get("email_verified"):
        logger.warning(
            "google_login: rejected token for unverified email %r",
            payload.get("email"),
        )
        return None

    return payload


def _unique_username_from_email(email):
    base = re.sub(r"[^a-z0-9_]", "", email.split("@")[0].lower())[:20] or "user"
    candidate = base
    while User.objects.filter(username=candidate).exists():
        candidate = f"{base}-{secrets.token_hex(3)}"
    return candidate


def _issue_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": UserSerializer(user).data,
    }


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([GoogleLoginRateThrottle])
def google_login(request):
    """Sign in or register via a Google ID token.

    Request body:
      { "id_token": "<JWT from Google>", "role": "user" | "agent" (optional) }

    Responses:
      200 { refresh, access, user }                   — existing user signed in
      200 { needs_role: true, email, suggested_username }
                                                       — new user, frontend must
                                                         resubmit with `role`
      409 { error: "...", code: "email_already_registered" }
                                                       — local account owns this
                                                         email (no auto-linking)
      403 { error: "..." }                             — admin/suspended/inactive
      401 { error: "Invalid Google token" }            — verification failed
      400 { error: "..." }                             — missing/invalid input
    """
    id_token_str = request.data.get("id_token")
    if not id_token_str:
        return Response({"error": "id_token is required"}, status=status.HTTP_400_BAD_REQUEST)

    payload = _verify_google_id_token(id_token_str)
    if payload is None:
        return Response({"error": "Invalid Google token"}, status=status.HTTP_401_UNAUTHORIZED)

    google_sub = payload["sub"]
    email = payload["email"].lower().strip()
    first_name = payload.get("given_name", "") or ""
    last_name = payload.get("family_name", "") or ""

    # Case 1: returning Google user — SocialAccount already linked.
    social = (
        SocialAccount.objects
        .select_related("user")
        .filter(provider=SocialAccount.PROVIDER_GOOGLE, provider_user_id=google_sub)
        .first()
    )
    if social is not None:
        user = social.user

        # Admins/staff must use password login (per product decision).
        if user.is_staff or user.is_superuser or user.role == "admin":
            return Response(
                {"error": "Administrator accounts must sign in with a password."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not user.is_active:
            return Response(
                {"error": "This account has been deactivated."},
                status=status.HTTP_403_FORBIDDEN,
            )

        suspension = _get_active_suspension(user)
        if suspension:
            return Response(_suspension_response(suspension), status=status.HTTP_403_FORBIDDEN)

        social.last_login_at = timezone.now()
        social.save(update_fields=["last_login_at"])
        return Response(_issue_tokens_for_user(user), status=status.HTTP_200_OK)

    # Case 2: email already owned by a local (password) account — no auto-link.
    if User.objects.filter(email__iexact=email).exists():
        return Response(
            {
                "error": "An account with this email already exists. Please log in with your password.",
                "code": "email_already_registered",
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Case 3: new user. Require a role choice on this second call.
    role = request.data.get("role")
    if role is None:
        return Response(
            {
                "needs_role": True,
                "email": email,
                "suggested_username": _unique_username_from_email(email),
                "first_name": first_name,
                "last_name": last_name,
            },
            status=status.HTTP_200_OK,
        )

    if role not in GOOGLE_SIGNUP_ALLOWED_ROLES:
        return Response(
            {"error": "Invalid role. Choose 'user' or 'agent'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        with transaction.atomic():
            # Re-check inside the transaction to close the race window between
            # the needs_role response and this call.
            if User.objects.filter(email__iexact=email).exists():
                return Response(
                    {
                        "error": "An account with this email already exists. Please log in with your password.",
                        "code": "email_already_registered",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            username = _unique_username_from_email(email)
            user = User(
                username=username,
                email=email,
                first_name=first_name,
                last_name=last_name,
                role=role,
                email_verified=True,
                is_active=True,
            )
            user.set_unusable_password()
            user.save()

            SocialAccount.objects.create(
                user=user,
                provider=SocialAccount.PROVIDER_GOOGLE,
                provider_user_id=google_sub,
                email_at_link=email,
                last_login_at=timezone.now(),
            )
    except Exception:
        return Response(
            {"error": "Could not complete Google sign-up. Please try again."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return Response(_issue_tokens_for_user(user), status=status.HTTP_201_CREATED)
