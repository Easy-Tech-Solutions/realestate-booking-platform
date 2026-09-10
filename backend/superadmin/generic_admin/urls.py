from django.urls import path

from . import views

urlpatterns = [
    path('<str:model_key>/', views.generic_list_create, name='generic_admin_list_create'),
    path('<str:model_key>/<int:pk>/', views.generic_detail, name='generic_admin_detail'),
]
