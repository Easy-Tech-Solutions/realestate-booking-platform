from django.urls import path

from . import views

urlpatterns = [
    path('resource-tree/', views.resource_tree, name='rbac-resource-tree'),
    path('my-permissions/', views.my_permissions, name='rbac-my-permissions'),

    path('roles/', views.roles_collection, name='rbac-roles-collection'),
    path('roles/<int:pk>/', views.role_detail, name='rbac-role-detail'),
    path('roles/<int:pk>/permissions/', views.role_add_permission, name='rbac-role-add-permission'),
    path('roles/<int:pk>/permissions/<int:perm_id>/', views.role_remove_permission, name='rbac-role-remove-permission'),

    path('user-roles/', views.user_roles_collection, name='rbac-user-roles-collection'),
    path('user-roles/<int:pk>/', views.user_role_detail, name='rbac-user-role-detail'),

    path('break-glass/', views.break_glass_collection, name='rbac-break-glass-collection'),
    path('break-glass/<int:pk>/revoke/', views.break_glass_revoke, name='rbac-break-glass-revoke'),

    path('approvals/', views.pending_approvals_list, name='rbac-approvals-list'),
    path('approvals/<int:pk>/approve/', views.pending_approval_approve, name='rbac-approval-approve'),
    path('approvals/<int:pk>/reject/', views.pending_approval_reject, name='rbac-approval-reject'),
]
