from django.contrib import admin
<<<<<<< HEAD
from django.conf import settings
from django.conf.urls.static import static
=======
>>>>>>> dalton
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
<<<<<<< HEAD
    # path('accounts/', include('django_otp.forms')),
    # path('accounts/', include('allauth_2fa.urls')),
    # path('accounts/', include('allauth.urls')),
=======
>>>>>>> dalton
    path('api/auth/', include('authapp.urls')),
    path('api/listings/', include('listings.urls')),
    path('api/bookings/', include('bookings.urls')),
    path('api/users/', include('users.urls')),
]
<<<<<<< HEAD
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) #Only for development server
=======
>>>>>>> dalton
