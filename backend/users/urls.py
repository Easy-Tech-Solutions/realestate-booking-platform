from django.urls import path
from .views import users_collection, user_detail, me_dashboard, update_profile

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('<int:id>/', user_detail, name='user_detail'),
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
    path('me/profile/', update_profile, name='update_profile'),
]
