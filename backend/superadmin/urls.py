from django.urls import path

from . import views

urlpatterns = [
    path('me/', views.me_view, name='superadmin_me'),
    path('mfa/setup/', views.mfa_setup, name='superadmin_mfa_setup'),
    path('mfa/confirm/', views.mfa_confirm, name='superadmin_mfa_confirm'),
    path('mfa/disable/', views.mfa_disable, name='superadmin_mfa_disable'),
    path('mfa/verify-login/', views.mfa_verify_login, name='superadmin_mfa_verify_login'),
    path('audit-log/', views.audit_log_list, name='superadmin_audit_log'),
    path('impersonate/<int:user_id>/start/', views.impersonate_start, name='superadmin_impersonate_start'),
    path('impersonate/stop/', views.impersonate_stop, name='superadmin_impersonate_stop'),
]
