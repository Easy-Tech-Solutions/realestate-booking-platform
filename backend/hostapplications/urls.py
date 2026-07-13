from django.urls import path
from . import views

urlpatterns = [
    # POST /api/host-applications/      → submit a new application
    path('', views.host_applications_collection, name='host-applications-collection'),

    # GET  /api/host-applications/me/   → my latest application + status
    path('me/', views.my_host_application, name='my-host-application'),

    # GET  /api/host-applications/agreement/         → current version + my acceptance
    path('agreement/', views.agreement_status, name='agreement-status'),
    # POST /api/host-applications/agreement/accept/  → record acceptance
    path('agreement/accept/', views.accept_agreement, name='agreement-accept'),

    # GET  /api/host-applications/review-queue/  → pending applications for this reviewer
    path('review-queue/', views.review_queue, name='host-application-review-queue'),
    # POST /api/host-applications/<pk>/review/   → approve/decline at the current stage
    path('<int:pk>/review/', views.review_decision, name='host-application-review'),
]
