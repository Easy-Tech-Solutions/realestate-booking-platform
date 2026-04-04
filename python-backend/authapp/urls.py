from django.urls import path
<<<<<<< HEAD
from .views import register, verify_email, login_view, logout_view, me, refresh_token_view

urlpatterns = [
    path('register/', register, name='register'),
    path('verify-email/', verify_email, name='verify_email'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('refresh-token/', refresh_token_view, name='refresh_token'),
    path('me/', me, name='me'),
]
=======
from .views import login_view, register, me

urlpatterns = [
    path('login', login_view, name='login'),
    path('register', register, name='register'),
    path('me', me, name='me'),
]
>>>>>>> dalton
