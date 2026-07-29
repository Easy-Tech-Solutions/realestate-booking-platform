from django.urls import path
from . import views

urlpatterns = [
    # GET  /api/lease-agreements/for-booking/<id>/  → lease for a booking (tenant or owner)
    path('for-booking/<int:booking_id>/', views.lease_for_booking, name='lease-for-booking'),
    # POST /api/lease-agreements/<id>/accept/        → tenant records acceptance
    path('<int:booking_id>/accept/', views.accept_lease, name='lease-accept'),
]
