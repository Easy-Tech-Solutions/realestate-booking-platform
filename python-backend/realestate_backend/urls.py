from django.contrib import admin
<<<<<<< HEAD
<<<<<<< HEAD
from django.conf import settings
from django.conf.urls.static import static
=======
>>>>>>> dalton
=======
from django.conf import settings
from django.conf.urls.static import static
>>>>>>> origin/jake
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
<<<<<<< HEAD
<<<<<<< HEAD
    # path('accounts/', include('django_otp.forms')),
    # path('accounts/', include('allauth_2fa.urls')),
    # path('accounts/', include('allauth.urls')),
=======
>>>>>>> dalton
=======
    # path('accounts/', include('django_otp.forms')),
    # path('accounts/', include('allauth_2fa.urls')),
    # path('accounts/', include('allauth.urls')),
>>>>>>> origin/jake
    path('api/auth/', include('authapp.urls')),
    path('api/listings/', include('listings.urls')),
    path('api/bookings/', include('bookings.urls')),
    path('api/users/', include('users.urls')),
    path('api/payments/', include('payments.urls')),
    path('api/messaging/', include('messaging.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/reports/', include('reports.urls')),
]
<<<<<<< HEAD
<<<<<<< HEAD
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) #Only for development server
=======
>>>>>>> dalton
=======
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) #Only for development server
>>>>>>> origin/jake
