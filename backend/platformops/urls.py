from django.urls import path

from . import views

urlpatterns = [
    path('feature-flags/', views.feature_flags_collection, name='feature-flags-collection'),
    path('feature-flags/<int:pk>/', views.feature_flag_detail, name='feature-flag-detail'),
    path('system-health/', views.system_health, name='system-health'),
    path('recent-errors/', views.recent_errors, name='recent-errors'),
    path('flush-cache/', views.flush_cache, name='flush-cache'),
    path('server-metrics/', views.server_metrics, name='server-metrics'),
    path('log-viewer/', views.log_viewer, name='log-viewer'),
]
