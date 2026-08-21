from django.urls import path
from . import views

urlpatterns = [
    # POST /api/agents/applications/       → apply to become a sourcing agent
    path('applications/', views.agent_applications_collection, name='agent-applications-collection'),
    # GET  /api/agents/applications/me/    → my latest application + is_agent
    path('applications/me/', views.my_agent_application, name='my-agent-application'),
    # GET  /api/agents/dashboard/          → agent dashboard summary
    path('dashboard/', views.agent_dashboard, name='agent-dashboard'),
    # POST /api/agents/list-property/      → agent submits a property on an owner's behalf
    path('list-property/', views.agent_list_property, name='agent-list-property'),
]
