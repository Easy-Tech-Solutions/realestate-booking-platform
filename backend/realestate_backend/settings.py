import os
from pathlib import Path
from datetime import timedelta
#from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl
from django.templatetags.static import static

BASE_DIR = Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_origins(name: str, default: str = "") -> list[str]:
    """Like env_list but silently drops entries that lack an http/https scheme."""
    raw = os.environ.get(name, default)
    origins = []
    for item in raw.split(","):
        item = item.strip()
        if item and (item.startswith("http://") or item.startswith("https://")):
            origins.append(item)
    return origins

_secret_key = os.environ.get("DJANGO_SECRET_KEY", "")
if not _secret_key:
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(50))\""
    )
SECRET_KEY = _secret_key

DEBUG = env_bool("DJANGO_DEBUG", False)

# If DJANGO_ALLOWED_HOSTS is explicitly set, use it.
# Otherwise allow localhost + any *.onrender.com subdomain automatically.
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
_default_hosts = "localhost,127.0.0.1" + (f",{_render_host}" if _render_host else "")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", _default_hosts)

# Always trust every *.onrender.com hostname so Render custom-domain
# routing and health-check pings never produce a DisallowedHost 400.
if not os.environ.get("DJANGO_ALLOWED_HOSTS"):
    ALLOWED_HOSTS += [".onrender.com"]

INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "daphne",
    "channels",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    "rest_framework",
    "corsheaders",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "cloudinary",
    "cloudinary_storage",
    "anymail",
    # Local apps
    "authapp",
    "listings",
    "bookings",
    "users",
    "payments",
    "messaging",
    "notifications",
    "reports",
    "suspensions",
    "newsletter",
    "testimonials",
    "support",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves /static/* directly from STATIC_ROOT in production so
    # Django admin's CSS/JS/icons load without a separate web server.
    # Must come immediately after SecurityMiddleware per WhiteNoise docs.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "suspensions.middleware.SuspensionMiddleware",
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

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    # Hosted environments (Render, Vercel, etc.) typically inject a single
    # DATABASE_URL. Parse it into the per-field config Django expects.
    tmpPostgres = urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": tmpPostgres.path.lstrip("/"),
            "USER": tmpPostgres.username,
            "PASSWORD": tmpPostgres.password,
            "HOST": tmpPostgres.hostname,
            "PORT": tmpPostgres.port or 5432,
            "OPTIONS": dict(parse_qsl(tmpPostgres.query)),
        }
    }
elif os.environ.get("DB_ENGINE", "sqlite").lower() == "postgres":
    # Local dev with discrete POSTGRES_* env vars.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ["POSTGRES_USER"],
            "PASSWORD": os.environ["POSTGRES_PASSWORD"],
            "HOST": os.environ["POSTGRES_HOST"],
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": int(os.environ.get("POSTGRES_CONN_MAX_AGE", "60")),
            "OPTIONS": {
                "sslmode": os.environ.get("POSTGRES_SSLMODE", "require"),
                "channel_binding": os.environ.get("POSTGRES_CHANNEL_BINDING", "require"),
            },
        }
    }
else:
    # Fresh checkout with no DB config — fall back to SQLite for local dev.
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

REDIS_URL = os.environ.get('REDIS_URL')

# Managed Redis providers (Render Key Value, Upstash, AWS ElastiCache, etc.)
# typically hand out rediss:// URLs without ssl_cert_reqs. redis-py's URL
# parser refuses to load such URLs and raises ValueError. Append the
# parameter ourselves so cache, Celery, and channels_redis all stay happy.
if REDIS_URL and REDIS_URL.startswith('rediss://') and 'ssl_cert_reqs' not in REDIS_URL:
    # redis-py accepts the lowercase short forms "none", "optional", "required"
    # (NOT the Python ssl.CERT_* constant names, despite a confusingly worded
    # error message in older versions). "none" is the standard pragmatic
    # choice for managed Redis providers whose certs don't always chain to a
    # publicly trusted CA.
    REDIS_URL += ('&' if '?' in REDIS_URL else '?') + 'ssl_cert_reqs=none'

USE_DB_CACHE = env_bool("DJANGO_USE_DB_CACHE", False)

if REDIS_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
        }
    }
elif USE_DB_CACHE:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
            'LOCATION': 'rate_limit_cache',
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'realestate-booking-platform',
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
        "login": "10/min" if DEBUG else "5/min",
        "register": "100/hour" if DEBUG else "5/hour",
        "password_reset": "3/hour",
        "verify_email": "10/hour",
        "phone_change": "5/hour",
        "google_login": "20/min" if DEBUG else "10/min",
    },
}

# Base allowed origins — always present regardless of DEBUG
# Exact origins only — no wildcard regex; credentials must never be sent to unknown subdomains.
_dev_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
] if DEBUG else []

CORS_ALLOWED_ORIGINS = [
    *_dev_origins,
    "https://homekonet.vercel.app",
    "https://realestate-booking-platform.vercel.app",
]

# Additional origins supplied via environment (comma-separated, must be exact https:// URLs)
for _origin in env_origins("CORS_ALLOWED_ORIGINS", ""):
    if _origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(_origin)
_fe_origin = os.environ.get("FRONTEND_ORIGIN", "")
if _fe_origin and _fe_origin not in CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS.append(_fe_origin)

CORS_ALLOWED_ORIGIN_REGEXES: list[str] = []  # no regex patterns — exact origins only
CORS_ALLOW_CREDENTIALS = True
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")

# CSRF trusted origins (required by Django 4+ for cross-origin POSTs to the
# admin). DRF endpoints use JWT/header auth and are not CSRF-protected, but the
# Django admin (session auth) is — so it must trust the API's own public origin.
# Default to an https origin for every non-local, non-wildcard allowed host,
# plus the frontend origin; extend with the CSRF_TRUSTED_ORIGINS env var.
CSRF_TRUSTED_ORIGINS = [
    f"https://{_host}" for _host in ALLOWED_HOSTS
    if _host and _host not in ("localhost", "127.0.0.1") and not _host.startswith((".", "*"))
]
for _origin in env_origins("CSRF_TRUSTED_ORIGINS", ""):
    if _origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(_origin)
if _fe_origin and _fe_origin not in CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS.append(_fe_origin)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    # 14-day sliding session: every refresh rotates the token and resets this
    # window (see authapp.views.refresh_token_view), so users stay logged in
    # through normal use and are only signed out after ~14 days of inactivity.
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# --- Refresh token cookie ---------------------------------------------------
# The refresh token is delivered ONLY as an httpOnly, first-party cookie so it
# is never readable by JavaScript (mitigates XSS token theft — TEST-AUTH-02).
#
# IMPORTANT: this REQUIRES the SPA and API to be served same-site (same
# registrable domain) — e.g. app.example.com + api.example.com, or the SPA
# origin reverse-proxying /api/* to the backend. With SameSite=Lax a
# cross-site request does NOT carry the cookie, so a cross-domain deployment
# must either move same-site or override AUTH_REFRESH_COOKIE_SAMESITE=None
# (which Safari/Brave/Firefox increasingly block). See the deployment note in
# docs/backend/infrastructure-production.md.
AUTH_REFRESH_COOKIE_NAME = "refresh_token"
AUTH_REFRESH_COOKIE_PATH = "/api/auth/"
AUTH_REFRESH_COOKIE_SAMESITE = os.environ.get("AUTH_REFRESH_COOKIE_SAMESITE", "Lax")
AUTH_REFRESH_COOKIE_DOMAIN = os.environ.get("AUTH_REFRESH_COOKIE_DOMAIN") or None
AUTH_REFRESH_COOKIE_SECURE = not DEBUG
AUTH_REFRESH_COOKIE_MAX_AGE = int(SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds())

EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "anymail.backends.sendinblue.EmailBackend",
)
ANYMAIL = {
    "SENDINBLUE_API_KEY": os.environ.get("BREVO_API_KEY", ""),
}
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "homekonnet@gmail.com")
EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "15"))
SITE_ID = 1

AUTH_REQUIRE_EMAIL_VERIFICATION = env_bool("AUTH_REQUIRE_EMAIL_VERIFICATION", True)

LOCAL_DOMAIN = os.environ.get("LOCAL_DOMAIN", "localhost:8000")
SITE_NAME = os.environ.get("SITE_NAME", "Real Estate Booking Platform")

# Web Push (VAPID) — generate keys once with: python manage.py generate_vapid_keys
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS_EMAIL = os.environ.get("VAPID_CLAIMS_EMAIL", DEFAULT_FROM_EMAIL or "admin@homekonet.com")

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
]

AUTH_USER_MODEL = "users.User"

GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")

CLOUDINARY_URL = os.environ.get('CLOUDINARY_URL', '')

UNFOLD = {
    "SITE_TITLE": "Home Konet Admin",
    "SITE_HEADER": "Home Konet Admin",
    "SITE_URL": "https://realestate-booking-platform.vercel.app",
    "SITE_ICON": lambda request: static("admin/Home-Konet-Logo2.jpeg"),
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": True,
    "THEME": None,  #None = follow OS / user toggle. "light" or "dark" forces it.

    "COLORS": {
        "primary": {
            "50": "240 250 241",
            "100": "214 241 216",
            "200": "173 228 179",
            "300": "121 207 131",
            "400": "74 178 89",
            "500": "42 146 57",
            "600": "29 113 41",
            "700": "20 89 31",
            "800": "0 68 6",  #brand color #004406
            "900": "0 51 10",
            "950": "0 37 7",
        },
    },
}
if CLOUDINARY_URL:
    import cloudinary
    cloudinary.config(cloudinary_url=CLOUDINARY_URL)
    STORAGES = {
        "default": {
            "BACKEND": "cloudinary_storage.storage.MediaCloudinaryStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
        },
    }
    MEDIA_URL = '/media/'
else:
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
        },
    }
    MEDIA_URL = '/media/'
    MEDIA_ROOT = os.path.join(BASE_DIR, 'media')
    os.makedirs(MEDIA_ROOT, exist_ok=True)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')

PAYMENT_GATEWAYS = {
    'mtn_momo': {
        'api_key': os.environ.get('MTN_MOMO_API_KEY'),
        'user_id': os.environ.get('MTN_MOMO_USER_ID'),
        'api_secret': os.environ.get('MTN_MOMO_API_SECRET'),
        'sandbox_url': 'https://sandbox.momodeveloper.mtn.com',
        'live_url': 'https://api.momodeveloper.mtn.com',
    },
}

DEFAULT_CURRENCY = 'LRD'
SUPPORTED_CURRENCIES = ['LRD', 'USD']

if REDIS_URL:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [REDIS_URL],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }

MESSAGE_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024

# Max file upload size: 10 MB per file
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

CELERY_BROKER_URL = REDIS_URL or 'redis://localhost:6379/0'
CELERY_RESULT_BACKEND = REDIS_URL or 'redis://localhost:6379/0'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ALWAYS_EAGER = env_bool('CELERY_ALWAYS_EAGER', DEBUG)
CELERY_TASK_EAGER_PROPAGATES = True

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', True)
    SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

