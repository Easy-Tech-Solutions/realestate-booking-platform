import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "change-me-in-prod")
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    #Auth
    "django.contrib.sites",
    # "allauth",
    # "allauth.account",
    # "allauth.socialaccount",
    # "django_otp",
    # "django_otp.plugins.otp_totp",
    # "django_otp.plugins.otp_static",
    # "allauth_2fa",
    # Third-party
    "rest_framework",
    "corsheaders",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    #"django_ratelimit",
    # Local apps
    "authapp",
    "listings",
    "bookings",
    "users",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # "django_otp.middleware.OTPMiddleware",
    # "django.contrib.allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "realestate_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "realestate_backend.wsgi.application"
ASGI_APPLICATION = "realestate_backend.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "static"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Cache configuration for django-ratelimit
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'rate_limit_cache',
    }
}

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
}

CORS_ALLOWED_ORIGINS = [
    #Development origins
    "http://localhost:3000",  #Create React App
    "http://localhost:5173",  #Vite
    "http://127.0.0.1:3000",  #Alternative localhost
    "http://127.0.0.1:5173",  #Alternative localhost
    #Production origin (from environment variable)
    os.environ.get("FRONTEND_ORIGIN", "https://yourdomain.com"),
]
CORS_ALLOW_CREDENTIALS = True 

#JWT Settings
from datetime import timedelta
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

#Email Settings
# EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"   #For Production
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend" #For Development
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL")
SITE_ID = 1
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_AUTHENTICATION_METHOD = "username_email"
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_LOGOUT_ON_PASSWORD_CHANGE = True
ACCOUNT_SESSION_REMEMBER = True
ACCOUNT_USERNAME_MIN_LENGTH = 3
ACCOUNT_EMAIL_CONFIRMATION_EXPIRE_DAYS = 1
ACCOUNT_EMAIL_SUBJECT_PREFIX = "easytechsolutions.com" #Or our site name if that's not it. 
LOGIN_URL = "/"
LOGIN_REDIRECT_URL = "/"

# Custom settings for email verification
LOCAL_DOMAIN = os.environ.get("LOCAL_DOMAIN", "localhost:8000")
SITE_NAME = os.environ.get("SITE_NAME", "Real Estate Booking Platform")

#Allauth Settings
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

#2FA Settings
TWO_FACTOR_SMS_GATEWAY = "two_factor.gateways.fake.Fake"  #For Development
TWO_FACTOR_CALL_GATEWAY = "two_factor.gateways.fake.Fake"  #For Development
TWO_FACTOR_REMEMBER_COOKIE_AGE = 60 * 60 * 24 * 30  #30 days

#Allauth 2FA Settings
ACCOUNT_ADAPTER = "allauth_2fa.adapter.OTPAdapter"
AUTH_USER_MODEL = "users.User"