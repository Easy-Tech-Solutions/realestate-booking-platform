from django.urls import path

from . import views

urlpatterns = [
    path('me/', views.me_view, name='superadmin_me'),
    path('mfa/setup/', views.mfa_setup, name='superadmin_mfa_setup'),
    path('mfa/confirm/', views.mfa_confirm, name='superadmin_mfa_confirm'),
    path('mfa/disable/', views.mfa_disable, name='superadmin_mfa_disable'),
    path('mfa/verify-login/', views.mfa_verify_login, name='superadmin_mfa_verify_login'),
    path('mfa/send-email-code/', views.mfa_send_email_code, name='superadmin_mfa_send_email_code'),
    path('audit-log/', views.audit_log_list, name='superadmin_audit_log'),
    path('impersonate/<int:user_id>/start/', views.impersonate_start, name='superadmin_impersonate_start'),
    path('impersonate/stop/', views.impersonate_stop, name='superadmin_impersonate_stop'),

    path('staff/', views.admin_staff_list, name='superadmin_staff_list'),
    path('staff/<int:pk>/', views.admin_staff_detail, name='superadmin_staff_detail'),
    path('staff/me/', views.staff_me, name='superadmin_staff_me'),
    path('staff/me/education/', views.staff_me_education, name='superadmin_staff_me_education'),
    path('staff/me/education/<int:pk>/', views.staff_me_education_detail, name='superadmin_staff_me_education_detail'),
    path('staff/me/legal/', views.staff_me_legal, name='superadmin_staff_me_legal'),
    path('staff/me/legal/<int:pk>/', views.staff_me_legal_detail, name='superadmin_staff_me_legal_detail'),
]
