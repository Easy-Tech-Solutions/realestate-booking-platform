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
    #Channels (must come before local apps)
    "daphne",
    "channels",
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
    "django_filters",
    #"django_ratelimit",
    # Local apps
    "authapp",
    "listings",
    "bookings",
    "users",
    "payments",
    "messaging",
    "notifications",
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
    "listings.middleware.ViewTrackingMiddleware",
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
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
    ),
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "user": "1000/day",
        "login": "5/min",
        "register": "5/hour",
        "password_reset": "3/hour",
        "verify_email": "10/hour",
    },
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
    # "allauth.account.auth_backends.AuthenticationBackend",  # Commented out since allauth is not installed
]

#2FA Settings
TWO_FACTOR_SMS_GATEWAY = "two_factor.gateways.fake.Fake"  #For Development
TWO_FACTOR_CALL_GATEWAY = "two_factor.gateways.fake.Fake"  #For Development
TWO_FACTOR_REMEMBER_COOKIE_AGE = 60 * 60 * 24 * 30  #30 days

#Allauth 2FA Settings
ACCOUNT_ADAPTER = "allauth_2fa.adapter.OTPAdapter"
AUTH_USER_MODEL = "users.User"

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')
os.makedirs(MEDIA_ROOT, exist_ok=True)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


#Payment Settings
PAYMENT_GATEWAYS = {
    'flutterwave': {
        'public_key': os.environ.get('FLUTTERWAVE_PUBLIC_KEY'),
        'secret_key': os.environ.get('FLUTTERWAVE_SECRET_KEY'),
        'webhook_key': os.environ.get('FLUTTERWAVE_WEBHOOK_KEY'),
        'sandbox_url': 'https://rave-api-v2.herokuapp.com',  #Not the real sandbox url
        'live_url': 'https://api.flutterwave.com',           #Not the real live url
    },
    'mtn_momo': {
        'api_key': os.environ.get('MTN_MOMO_API_KEY'),
        'user_id': os.environ.get('MTN_MOMO_USER_ID'),
        'api_secret': os.environ.get('MTN_MOMO_API_SECRET'),
        'sandbox_url': 'https://sandbox.momodeveloper.mtn.com',    #Not the real url
        'live_url': 'https://api.momodeveloper.mtn.com',           #Not the real url
    },
    'orange_money': {
        'api_key': os.environ.get('ORANGE_MONEY_API_KEY'),
        'api_secret': os.environ.get('ORANGE_MONEY_API_SECRET'),
        'sandbox_url': 'https://api.orange.com/orange-money',      #Not the real url
        'live_url': 'https://api.orange.com/orange-money',         #Not the real ur
    }
}

#Currency settings
DEFAULT_CURRENCY = 'LRD'
SUPPORTED_CURRENCIES = ['LRD','USD']

# ─── Django Channels / Real-time Messaging ────────────────────────────────────
# Development: InMemoryChannelLayer needs no external services — works out of
# the box. Messages are only delivered within the same process, which is fine
# for a single dev server.
#
# Production: Switch to RedisChannelLayer so messages are shared across all
# server processes/workers. Set REDIS_URL in your environment to activate it.
if os.environ.get('REDIS_URL'):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [os.environ.get('REDIS_URL')],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }

# Maximum allowed size for a single file attachment (10 MB)
MESSAGE_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024  # 10 MB in bytes

# ─── Celery ────────────────────────────────────────────────────────────────────
# Production: set REDIS_URL (e.g. redis://localhost:6379/0) in your environment.
# Development fallback: CELERY_TASK_ALWAYS_EAGER runs tasks synchronously in the
# same process — no broker needed, emails send inline.  Set to False in prod.
CELERY_BROKER_URL        = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND    = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT    = ['json']
CELERY_TASK_SERIALIZER   = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE          = TIME_ZONE

# In development (no Redis running) tasks run synchronously — flip to False in prod
CELERY_TASK_ALWAYS_EAGER = os.environ.get('CELERY_ALWAYS_EAGER', 'true').lower() == 'true'
CELERY_TASK_EAGER_PROPAGATES = True  # surface task exceptions during development