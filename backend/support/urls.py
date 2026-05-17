from django.urls import path
from . import views

urlpatterns = [
    # Contact (public)
    path('contact/', views.contact_create, name='support-contact-create'),

    # Tickets (user-facing)
    path('tickets/', views.ticket_list_create, name='support-ticket-list-create'),
    path('tickets/<int:pk>/', views.ticket_detail, name='support-ticket-detail'),
    path('tickets/<int:pk>/messages/', views.ticket_add_message, name='support-ticket-add-message'),

    # Search (public)
    path('search/', views.ticket_search, name='support-ticket-search'),

    # Admin
    path('admin/tickets/', views.admin_ticket_list, name='support-admin-ticket-list'),
    path('admin/tickets/<int:pk>/', views.admin_ticket_update, name='support-admin-ticket-update'),
    path('admin/contact/', views.admin_contact_list, name='support-admin-contact-list'),
    path('admin/contact/<int:pk>/', views.admin_contact_update, name='support-admin-contact-update'),
    path('admin/stats/', views.admin_stats, name='support-admin-stats'),
]
