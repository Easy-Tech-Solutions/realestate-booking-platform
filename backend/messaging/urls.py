from django.urls import path
from . import views

urlpatterns = [
    # Conversations
    path('conversations/', views.ConversationListView.as_view(), name='conversation-list'),
    path('conversations/start/', views.StartConversationView.as_view(), name='conversation-start'),
    path('conversations/<int:conversation_id>/', views.DeleteConversationView.as_view(), name='conversation-delete'),

    # Messages
    path('conversations/<int:conversation_id>/messages/', views.MessageListView.as_view(), name='message-list'),
    path('conversations/<int:conversation_id>/messages/send/', views.SendMessageView.as_view(), name='message-send'),
    path('messages/<int:message_id>/edit/', views.EditMessageView.as_view(), name='message-edit'),

    # Presence
    path('users/<int:user_id>/presence/', views.UserPresenceView.as_view(), name='user-presence'),

    # Unread badge
    path('unread-count/', views.UnreadCountView.as_view(), name='unread-count'),
]
