from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.db import connection
from django.http import JsonResponse
from django.urls import path, include, re_path
from django.views.static import serve

handler404 = 'realestate_backend.error_views.handler_404'
handler500 = 'realestate_backend.error_views.handler_500'


def health_check(request):
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('api/health/', health_check),
    path(settings.ADMIN_URL, admin.site.urls),
    path('api/auth/', include('authapp.urls')),
    path('api/listings/', include('listings.urls')),
    path('api/bookings/', include('bookings.urls')),
    path('api/users/', include('users.urls')),
    path('api/payments/', include('payments.urls')),
    path('api/messaging/', include('messaging.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/reports/', include('reports.urls')),
    path('api/suspensions/', include('suspensions.urls')),
    path('api/newsletter/', include('newsletter.urls')),
    path('api/testimonials/', include('testimonials.urls')),
    path('api/support/', include('support.urls')),
    path('api/host-applications/', include('hostapplications.urls')),
    path('api/property-verifications/', include('propertyverifications.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif not getattr(settings, 'CLOUDINARY_URL', None) and getattr(settings, 'MEDIA_ROOT', None):
    # Only serve local media files when Cloudinary is NOT configured AND a real
    # MEDIA_ROOT is set. With Cloudinary active, MEDIA_ROOT is empty (Django default)
    # which would cause serve() to resolve paths against the CWD — a security hole.
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
