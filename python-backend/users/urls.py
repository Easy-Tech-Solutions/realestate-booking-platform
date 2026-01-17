from django.urls import path
from .views import users_collection, user_detail

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('<int:id>', user_detail, name='user_detail'),
]
