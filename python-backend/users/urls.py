from django.urls import path
<<<<<<< HEAD
from .views import users_collection, user_detail, me_dashboard
=======
from .views import users_collection, user_detail
>>>>>>> dalton

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('<int:id>', user_detail, name='user_detail'),
<<<<<<< HEAD
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
=======
>>>>>>> dalton
]
