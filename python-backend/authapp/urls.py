from django.urls import path
from .views import register, verify_email, login_view, logout_view, me

urlpatterns = [
    path('register', register, name='register'),
    path('verify-email/<str:token>/', verify_email, name='verify_email'),
    path('login', login_view, name='login'),
    path('logout', logout_view, name='logout'),
    path('me', me, name='me'),
]