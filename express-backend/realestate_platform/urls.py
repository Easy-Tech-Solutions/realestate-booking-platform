from django.contrib import admin
from django.urls import path, include
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/v1/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    path("api/v1/accounts/", include("apps.accounts.urls")),
    path("api/v1/properties/", include("apps.properties.urls")),
    path("api/v1/bookings/", include("apps.bookings.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/dashboards/", include("apps.dashboards.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/reviews/", include("apps.reviews.urls")),
    path("api/v1/analytics/", include("apps.analytics.urls")),
    path("api/v1/cms/", include("apps.cms.urls")),
    path("api/v1/support/", include("apps.support.urls")),
]
