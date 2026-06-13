from django.urls import path
from .views import (
    users_collection,
    user_detail,
    me_dashboard,
    update_profile,
    delete_account,
    initiate_phone_change,
    verify_phone_change,
    cancel_phone_change,
    admin_stats,
)

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('admin/stats/', admin_stats, name='admin_stats'),
    path('<int:id>/', user_detail, name='user_detail'),
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
    path('me/profile/', update_profile, name='update_profile'),
    path('me/delete/', delete_account, name='delete_account'),

    # Phone number change — 2-step verification
    path('phone-change/initiate/', initiate_phone_change, name='phone_change_initiate'),
    path('phone-change/verify/',   verify_phone_change,   name='phone_change_verify'),
    path('phone-change/cancel/',   cancel_phone_change,   name='phone_change_cancel'),
]
