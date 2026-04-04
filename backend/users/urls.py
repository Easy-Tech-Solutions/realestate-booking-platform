from django.urls import path
<<<<<<< HEAD
<<<<<<< HEAD
from .views import users_collection, user_detail, me_dashboard
=======
from .views import users_collection, user_detail
>>>>>>> dalton
=======
from .views import users_collection, user_detail, me_dashboard
>>>>>>> origin/jake

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('<int:id>', user_detail, name='user_detail'),
<<<<<<< HEAD
<<<<<<< HEAD
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
=======
>>>>>>> dalton
=======
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
>>>>>>> origin/jake
]
