from django.urls import path
from . import views

urlpatterns = [
    # --- User-facing ---
    # GET  /api/reports/           → list my reports
    # POST /api/reports/           → file a new report
    path('', views.reports_collection, name='reports-collection'),

    # GET  /api/reports/<pk>/      → detail (reporter or admin)
    path('<int:pk>/', views.report_detail, name='report-detail'),

    # --- Admin-only ---
    # GET  /api/reports/admin/           → all reports with filters
    path('admin/', views.admin_reports_list, name='admin-reports-list'),

    # GET  /api/reports/admin/stats/     → counts by status
    path('admin/stats/', views.admin_report_stats, name='admin-report-stats'),

    # POST /api/reports/admin/bulk/      → bulk resolve/dismiss/mark-under-review
    path('admin/bulk/', views.admin_bulk_report_action, name='admin-bulk-report-action'),

    # PATCH /api/reports/admin/<pk>/status/  → update status
    path('admin/<int:pk>/status/', views.admin_update_report_status, name='admin-report-status'),

    # POST /api/reports/admin/<pk>/escalate/ → flag for supervisor attention
    path('admin/<int:pk>/escalate/', views.admin_report_escalate, name='admin-report-escalate'),
]
