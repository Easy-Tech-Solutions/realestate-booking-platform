import logging
import re
import secrets

from realestate_backend.app_logging import log_activity

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
from django.template.loader import render_to_string
from django.db import transaction
User = get_user_model()

logger = logging.getLogger(__name__)


def _set_refresh_cookie(response, refresh):
    """Attach the refresh token as an httpOnly, first-party cookie.

    The token is delivered ONLY via this cookie (never the JSON body) so it is
    not reachable by JavaScript — mitigates XSS token theft (TEST-AUTH-02).
    Cookie attributes are centralised in settings.AUTH_REFRESH_COOKIE_*.
    """
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        str(refresh),
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
        max_age=settings.AUTH_REFRESH_COOKIE_MAX_AGE,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
    )


def _delete_refresh_cookie(response):
    response.delete_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
    )


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


def _client_ip(request):
    """Best-effort client IP, honouring the proxy's X-Forwarded-For (first hop)."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _blocked_fingerprint_response(request):
    """If the client sent a device fingerprint that Trust & Safety has
    blocked, return an error Response — else None."""
    fingerprint = request.META.get("HTTP_X_DEVICE_FINGERPRINT", "").strip()
    if not fingerprint:
        return None
    from trustsafety.models import BlockedFingerprint
    if BlockedFingerprint.objects.filter(fingerprint=fingerprint).exists():
        return Response(
            {"error": "This device is not permitted to create or access an account."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([RegisterRateThrottle])
def register(request):
    from platformops.utils import is_feature_enabled
    if not is_feature_enabled('new_registrations_enabled', default=True):
        return Response(
            {"error": "New account registration is temporarily disabled. Please try again later."},
            status=status.HTTP_403_FORBIDDEN,
        )

    blocked = _blocked_fingerprint_response(request)
    if blocked:
        return blocked

    email = request.data.get("email")
    password = request.data.get("password")
    password2 = request.data.get("password2")
    first_name = (request.data.get("first_name") or "").strip()
    last_name = (request.data.get("last_name") or "").strip()

    # Input validation
    if not all([password, email, password2, first_name, last_name]):
        return Response(
            {"error": "first_name, last_name, email, password, and password2 are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

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

    if User.objects.filter(email=email).exists():
        return Response({"error": "Email already exists"}, status=status.HTTP_400_BAD_REQUEST)

    username = _unique_username_from_email(email)

    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
                is_active=not settings.AUTH_REQUIRE_EMAIL_VERIFICATION,
            )
            if settings.AUTH_REQUIRE_EMAIL_VERIFICATION:
                from .utils import send_verification_email
                send_verification_email(user)

            from trustsafety.models import AccountSignupEvent
            AccountSignupEvent.objects.create(user=user, ip_address=_client_ip(request))
        message = "User registered successfully. Please check your email to verify your account."
        if not settings.AUTH_REQUIRE_EMAIL_VERIFICATION:
            message = "User registered successfully. You can now log in."
        log_activity(request, 'user_registered', resource_type='user', resource_id=user.id)
        return Response({"message": message}, status=status.HTTP_201_CREATED)
    except Exception:
        logger.exception("register: failed during user creation or email send")
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

    login_url = getattr(settings, "FRONTEND_ORIGIN", "") or f"https://{settings.LOCAL_DOMAIN}"

    try:
        user = User.objects.get(email_verification_token=token)
    except User.DoesNotExist:
        if request.method == "GET":
            html = render_to_string("auth/verification_failure.html", {
                "heading": "Invalid verification link",
                "message": "This verification link is invalid or has already been used.",
                "login_url": login_url,
                "site_name": settings.SITE_NAME,
            })
            return HttpResponse(html, status=400)
        return Response({"error": "Invalid verification token"}, status=status.HTTP_400_BAD_REQUEST)

    if user.email_verification_token_expires_at and timezone.now() > user.email_verification_token_expires_at:
        if request.method == "GET":
            html = render_to_string("auth/verification_failure.html", {
                "heading": "Link expired",
                "message": "This verification link has expired. Please request a new one.",
                "login_url": login_url,
                "site_name": settings.SITE_NAME,
            })
            return HttpResponse(html, status=400)
        return Response({"error": "Verification link has expired. Please request a new one."}, status=status.HTTP_400_BAD_REQUEST)

    user.email_verified = True
    user.is_active = True
    user.email_verification_token = None
    user.email_verification_token_expires_at = None
    user.save(update_fields=['email_verified', 'is_active', 'email_verification_token', 'email_verification_token_expires_at'])
    if request.method == "GET":
        html = render_to_string("auth/verification_success.html", {
            "login_url": login_url,
            "site_name": settings.SITE_NAME,
        })
        return HttpResponse(html)
    return Response({"message": "Email verified successfully"}, status=status.HTTP_200_OK)

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
    email = request.data.get("email")
    password = request.data.get("password")

    if not email or not password:
        return Response({"error": "email and password required"}, status=status.HTTP_400_BAD_REQUEST)

    blocked = _blocked_fingerprint_response(request)
    if blocked:
        return blocked

    # Email is not a unique column (see users.models.User), so more than one
    # account can share the same address — try each until one authenticates
    # rather than assuming .get() returns exactly one row.
    candidates = list(User.objects.filter(email__iexact=email))
    if not candidates:
        return Response({"error": "invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    user = None
    for candidate in candidates:
        authenticated = authenticate(request, username=candidate.username, password=password)
        if authenticated is not None:
            user = authenticated
            break

    if user is None:
        log_activity(request, 'user_login_failed', user_email=email)
        return Response({"error": "invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    if settings.AUTH_REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        return Response({"error": "Please verify your email before logging in. Check your email for the verification link."}, status=status.HTTP_403_FORBIDDEN)

    if not user.is_active:
        return Response({"error": "This account has been deactivated."}, status=status.HTTP_403_FORBIDDEN)

    # Check for an active suspension before issuing tokens
    suspension = _get_active_suspension(user)
    if suspension:
        return Response(_suspension_response(suspension), status=status.HTTP_403_FORBIDDEN)

    # Superadmin accounts with a confirmed MFA device must complete a TOTP
    # step-up before real tokens are issued — see superadmin.views.mfa_verify_login.
    from superadmin.models import MFADevice
    if MFADevice.objects.filter(user=user, confirmed=True).exists():
        from django.core.signing import TimestampSigner
        from superadmin.views import MFA_LOGIN_SALT
        signer = TimestampSigner(salt=MFA_LOGIN_SALT)
        return Response({
            "mfa_required": True,
            "mfa_token": signer.sign(str(user.pk)),
        })

    #Geneate JWT tokens
    refresh = RefreshToken.for_user(user)
    access_token = str(refresh.access_token)

    # The refresh token is delivered ONLY as an httpOnly cookie (never in the
    # JSON body) so JavaScript — and therefore any XSS — cannot read it.
    log_activity(request, 'user_login', user=user)
    response = Response({
        "access": access_token,
        "user": UserSerializer(user).data,
    })
    _set_refresh_cookie(response, refresh)
    return response

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    log_activity(request, 'user_logout')
    try:
        refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME) or request.data.get("refresh")
        if refresh_token:
            try:
                RefreshToken(refresh_token).blacklist()
            except TokenError:
                pass

        response = Response({"message": "Logged out successfully"}, status=status.HTTP_205_RESET_CONTENT)
        _delete_refresh_cookie(response)
        return response

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_token_view(request):
    refresh_token = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME) or request.data.get("refresh")
    if not refresh_token:
        return Response({"error": "Refresh token is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Constructing the token verifies signature, expiry AND the blacklist.
        # A replayed (already-rotated) refresh token is blacklisted, so this
        # raises TokenError -> 401. That is our refresh-token reuse detection.
        old_refresh = RefreshToken(refresh_token)
    except TokenError:
        response = Response({"error": "Invalid or expired refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
        _delete_refresh_cookie(response)
        return response

    user_id = old_refresh.get("user_id")
    try:
        user = User.objects.get(pk=user_id) if user_id else None
    except User.DoesNotExist:
        user = None
    if user is None or not user.is_active:
        response = Response({"error": "Invalid or expired refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
        _delete_refresh_cookie(response)
        return response

    # Block suspended users from minting new access tokens
    suspension = _get_active_suspension(user)
    if suspension:
        return Response(_suspension_response(suspension), status=status.HTTP_403_FORBIDDEN)

    # Rotate: blacklist the presented token and issue a fresh refresh token.
    # This resets the 14-day sliding window on every refresh and guarantees the
    # old token cannot be reused (the reuse check above will reject it).
    try:
        old_refresh.blacklist()
    except AttributeError:
        # token_blacklist app not installed — degrade to a non-rotating refresh.
        pass

    new_refresh = RefreshToken.for_user(user)
    access_token = str(new_refresh.access_token)
    response = Response({"access": access_token, "access_token": access_token})
    _set_refresh_cookie(response, new_refresh)
    return response
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

    # Email is not a unique column (see users.models.User), so more than one
    # account can share the same address — send a separate reset link for
    # each rather than assuming there's exactly one.
    users = User.objects.filter(email=email)
    if not users:
        # Return success regardless to avoid exposing whether an email exists
        return Response({"message": "If an account with that email exists, a password reset link has been sent."}, status=status.HTTP_200_OK)

    from .utils import send_password_reset_email
    for user in users:
        try:
            send_password_reset_email(user)
        except Exception:
            # Don't 500, and don't let a send failure distinguish this response
            # from the "no such account" branch above (that would leak account
            # existence to an attacker probing for valid emails).
            logger.exception("password_reset_request: failed to send reset email for user %s", user.pk)
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

    if user.password_reset_token_expires_at and timezone.now() > user.password_reset_token_expires_at:
        return Response({"error": "Invalid or expired reset token"}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(password)
    user.password_reset_token = None
    user.password_reset_token_expires_at = None
    user.save(update_fields=['password', 'password_reset_token', 'password_reset_token_expires_at'])
    return Response({"message": "Password reset successfully. You can now log in with your new password."}, status=status.HTTP_200_OK)


GOOGLE_ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


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


def _issue_tokens_for_user(user, http_status=200):
    refresh = RefreshToken.for_user(user)
    # Refresh token is delivered only as an httpOnly cookie (not in the body).
    response = Response(
        {
            "access": str(refresh.access_token),
            "user": UserSerializer(user).data,
        },
        status=http_status,
    )
    _set_refresh_cookie(response, refresh)
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([GoogleLoginRateThrottle])
def google_login(request):
    """Sign in or register via a Google ID token.

    Request body:
      { "id_token": "<JWT from Google>" }

    Every new account starts with role='user'. Users upgrade themselves to
    'agent' by clicking "Become a host" / "List Your Property", which hits
    /api/users/me/profile/. There is no role picker on signup.

    Responses:
      200 { refresh, access, user }                   — existing user signed in
      201 { refresh, access, user }                   — new user created
      409 { error: "...", code: "email_already_registered" }
                                                       — local account owns this
                                                         email (no auto-linking)
      403 { error: "..." }                             — admin/suspended/inactive
      401 { error: "Invalid Google token" }            — verification failed
      400 { error: "..." }                             — missing/invalid input
    """
    blocked = _blocked_fingerprint_response(request)
    if blocked:
        return blocked

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
        return _issue_tokens_for_user(user, http_status=status.HTTP_200_OK)

    # Case 2: email already owned by a local (password) account — no auto-link.
    if User.objects.filter(email__iexact=email).exists():
        return Response(
            {
                "error": "An account with this email already exists. Please log in with your password.",
                "code": "email_already_registered",
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Case 3: new user. Create with the default role ('user') — they can
    # upgrade to 'agent' later via the "Become a host" button.
    from platformops.utils import is_feature_enabled
    if not is_feature_enabled('new_registrations_enabled', default=True):
        return Response(
            {"error": "New account registration is temporarily disabled. Please try again later."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        with transaction.atomic():
            # Re-check inside the transaction to close any race window.
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
                role='user',
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

            from trustsafety.models import AccountSignupEvent
            AccountSignupEvent.objects.create(user=user, ip_address=_client_ip(request))
    except Exception:
        return Response(
            {"error": "Could not complete Google sign-up. Please try again."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return _issue_tokens_for_user(user, http_status=status.HTTP_201_CREATED)
