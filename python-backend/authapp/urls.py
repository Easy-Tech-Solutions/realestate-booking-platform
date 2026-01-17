from django.urls import path
from . import views

urlpatterns = [
    path('register', views.register, name='register'),
    path('register-page/', views.register_page, name='register_page'),
    path('verify-email/<str:token>/', views.verify_email, name='verify_email'),
    path('login', views.login_view, name='login'),
    path('logout', views.logout_view, name='logout'),
    path('me', views.me, name='me'),
]