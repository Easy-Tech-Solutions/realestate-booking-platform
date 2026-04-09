from django.urls import path
from . import views

urlpatterns = [
    # GET  /api/suspensions/               → list all (admin, filterable)
    # POST /api/suspensions/               → issue a new suspension (admin)
    path('', views.suspensions_collection, name='suspensions-collection'),

    # GET  /api/suspensions/<pk>/          → detail (admin)
    path('<int:pk>/', views.suspension_detail, name='suspension-detail'),

    # POST /api/suspensions/<pk>/revoke/   → lift a suspension early (admin)
    path('<int:pk>/revoke/', views.revoke_suspension, name='suspension-revoke'),

    # GET  /api/suspensions/user/<id>/     → full history for one user (admin)
    path('user/<int:user_id>/', views.user_suspension_history, name='suspension-user-history'),

    # GET  /api/suspensions/stats/         → counts by status / type (admin)
    path('stats/', views.suspension_stats, name='suspension-stats'),
]
