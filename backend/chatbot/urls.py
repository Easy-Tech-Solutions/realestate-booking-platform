from django.urls import path
from . import views

urlpatterns = [
    path('chat/', views.chat, name='chatbot-chat'),
    path('status/<str:task_id>/', views.chat_status, name='chatbot-status'),
    path('handoff/', views.handoff, name='chatbot-handoff'),
]
