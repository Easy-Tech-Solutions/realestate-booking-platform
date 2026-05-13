from django.urls import path
from .views import (
    users_collection,
    user_detail,
    me_dashboard,
    update_profile,
    initiate_phone_change,
    verify_phone_change,
    cancel_phone_change,
)

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('<int:id>/', user_detail, name='user_detail'),
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
    path('me/profile/', update_profile, name='update_profile'),

    # Phone number change — 2-step verification
    path('phone-change/initiate/', initiate_phone_change, name='phone_change_initiate'),
    path('phone-change/verify/',   verify_phone_change,   name='phone_change_verify'),
    path('phone-change/cancel/',   cancel_phone_change,   name='phone_change_cancel'),
]
