from django.urls import path
from . import views

urlpatterns = [
    # POST /api/host-applications/      → submit a new application
    path('', views.host_applications_collection, name='host-applications-collection'),

    # GET  /api/host-applications/me/   → my latest application + status
    path('me/', views.my_host_application, name='my-host-application'),
]
