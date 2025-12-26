from django.urls import path
from .views import login_view, register, me

urlpatterns = [
    path('login', login_view, name='login'),
    path('register', register, name='register'),
    path('me', me, name='me'),
]
