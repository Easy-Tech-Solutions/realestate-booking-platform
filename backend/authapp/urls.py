from django.urls import path
<<<<<<< HEAD
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
=======
from .views import register, verify_email, login_view, logout_view, me, refresh_token_view, password_reset_request, password_reset_confirm

urlpatterns = [
    path('register/', register, name='register'),
    path('verify-email/', verify_email, name='verify_email'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('refresh-token/', refresh_token_view, name='refresh_token'),
    path('me/', me, name='me'),
    path('password-reset/', password_reset_request, name='password_reset_request'),
    path('password-reset-confirm/', password_reset_confirm, name='password_reset_confirm'),
]
>>>>>>> origin/jake
