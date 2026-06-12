from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, include, re_path
from django.views.static import serve

handler404 = 'realestate_backend.error_views.handler_404'
handler500 = 'realestate_backend.error_views.handler_500'

urlpatterns = [
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
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    ]
