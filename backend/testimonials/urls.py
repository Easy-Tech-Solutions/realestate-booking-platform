from django.urls import path
from . import views

urlpatterns = [
    path('', views.testimonials_collection, name='testimonials-collection'),
    path('<int:pk>/', views.testimonial_detail, name='testimonial-detail'),
]
