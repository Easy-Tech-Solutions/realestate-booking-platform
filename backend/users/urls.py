from django.urls import path
from .views import (
    users_collection,
    user_detail,
    me_dashboard,
    update_profile,
    delete_my_account,
    initiate_phone_change,
    verify_phone_change,
    cancel_phone_change,
    admin_stats,
)
from .mfa_views import mfa_status, mfa_setup, mfa_confirm, mfa_disable
from .admin_views import (
    admin_user_list,
    admin_user_detail,
    admin_create_user,
    admin_update_user,
    admin_change_email,
    admin_reset_password,
    admin_toggle_active,
    admin_soft_delete_user,
    admin_hard_delete_user,
    admin_bulk_user_action,
)

urlpatterns = [
    path('', users_collection, name='users_collection'),
    path('admin/stats/', admin_stats, name='admin_stats'),
    path('admin/list/', admin_user_list, name='admin_user_list'),
    path('admin/create/', admin_create_user, name='admin_create_user'),
    path('admin/bulk/', admin_bulk_user_action, name='admin_bulk_user_action'),
    path('admin/<int:id>/', admin_user_detail, name='admin_user_detail'),
    path('admin/<int:id>/update/', admin_update_user, name='admin_update_user'),
    path('admin/<int:id>/email/', admin_change_email, name='admin_change_email'),
    path('admin/<int:id>/reset-password/', admin_reset_password, name='admin_reset_password'),
    path('admin/<int:id>/toggle-active/', admin_toggle_active, name='admin_toggle_active'),
    path('admin/<int:id>/soft-delete/', admin_soft_delete_user, name='admin_soft_delete_user'),
    path('admin/<int:id>/hard-delete/', admin_hard_delete_user, name='admin_hard_delete_user'),
    path('<int:id>/', user_detail, name='user_detail'),
    path('me/dashboard/', me_dashboard, name='me_dashboard'),
    path('me/profile/', update_profile, name='update_profile'),
    path('me/delete/',  delete_my_account, name='delete_my_account'),

    # Phone number change — 2-step verification
    path('phone-change/initiate/', initiate_phone_change, name='phone_change_initiate'),
    path('phone-change/verify/',   verify_phone_change,   name='phone_change_verify'),
    path('phone-change/cancel/',   cancel_phone_change,   name='phone_change_cancel'),

    # Self-service two-factor authentication (any authenticated user)
    path('mfa/status/',  mfa_status,  name='mfa_status'),
    path('mfa/setup/',   mfa_setup,   name='mfa_setup'),
    path('mfa/confirm/', mfa_confirm, name='mfa_confirm'),
    path('mfa/disable/', mfa_disable, name='mfa_disable'),
]
