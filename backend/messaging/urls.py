from django.urls import path
from . import views

urlpatterns = [
    #Conversation endpoints
    path('conversations/',views.ConversationListView.as_view(),name='conversation-list'),
    path('conversations/start/',views.StartConversationView.as_view(),name='conversation-start'),

    #Message endpoints
    path('conversations/<int:conversation_id>/messages/',views.MessageListView.as_view(),name='message-list'),
    path('conversations/<int:conversation_id>/messages/send/',views.SendMessageView.as_view(),name='message-send'),

    #Inbox badge
    path('unread-count/',views.UnreadCountView.as_view(),name='unread-count'),
]
