from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    # path('accounts/', include('django_otp.forms')),
    # path('accounts/', include('allauth_2fa.urls')),
    # path('accounts/', include('allauth.urls')),
    path('api/auth/', include('authapp.urls')),
    path('api/listings/', include('listings.urls')),
    path('api/bookings/', include('bookings.urls')),
    path('api/users/', include('users.urls')),
]
