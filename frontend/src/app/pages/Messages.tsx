import React, { useMemo, useState } from 'react';
import { Send, Image as ImageIcon, Paperclip, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { formatDate, getInitials } from '../../core/utils';
import { ReportDialog } from '../components/ReportDialog';
import { useApp } from '../../hooks/useApp';
import type { Conversation, User } from '../../core/types';
import { toast } from 'sonner';
import { getErrorMessage } from '../../services/api/shared/errors';
import { useConversationMessages, useConversations, useSendMessage } from '../../hooks/queries/useMessages';

function getOtherParticipant(conversation: Conversation, currentUserId?: string): User | undefined {
  return conversation.participants.find((participant) => participant.id !== currentUserId) || conversation.participants[0];
}

export function Messages() {
  const { isAuthenticated, user } = useApp();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const conversationsQuery = useConversations(isAuthenticated);
  const messagesQuery = useConversationMessages(selectedConversationId || undefined);
  const sendMessageMutation = useSendMessage();
  const conversations = React.useMemo(() => conversationsQuery.data || [], [conversationsQuery.data]);
  const messages = messagesQuery.data || [];

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  React.useEffect(() => {
    if (!selectedConversationId && conversations[0]?.id) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  React.useEffect(() => {
    if (conversationsQuery.error) {
      toast.error(getErrorMessage(conversationsQuery.error, 'Failed to load conversations'));
    }
  }, [conversationsQuery.error]);

  React.useEffect(() => {
    if (messagesQuery.error) {
      toast.error(getErrorMessage(messagesQuery.error, 'Failed to load messages'));
    }
  }, [messagesQuery.error]);

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
  };

  const handleSendMessage = async () => {
    if (!selectedConversationId || !messageInput.trim() || sendMessageMutation.isPending) {
      return;
    }

    try {
      await sendMessageMutation.mutateAsync({ conversationId: selectedConversationId, content: messageInput.trim() });
      setMessageInput('');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to send message'));
    }
  };

  const showChat = selectedConversation !== null;

  const ConversationList = () => (
    <div className="w-full lg:w-80 border-r border-border flex flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-semibold">Messages</h1>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {conversationsQuery.isLoading && (
            <p className="text-sm text-muted-foreground px-3 py-4">Loading conversations...</p>
          )}

          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-4">No conversations yet.</p>
          )}

          {conversations.map((conversation) => {
            const otherUser = getOtherParticipant(conversation, user?.id);
            const displayName = [otherUser?.firstName, otherUser?.lastName].filter(Boolean).join(' ') || otherUser?.email || 'Conversation';
            return (
              <button
                key={conversation.id}
                onClick={() => handleSelectConversation(conversation.id)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left ${
                  selectedConversation?.id === conversation.id ? 'bg-muted' : ''
                }`}
              >
                {otherUser?.avatar ? (
                  <img src={otherUser.avatar} alt={displayName} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
                    {getInitials(otherUser?.firstName || 'C', otherUser?.lastName || 'U')}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <p className="font-semibold truncate">{displayName}</p>
                    {conversation.unreadCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{conversation.lastMessage?.content || 'No messages yet'}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {conversation.lastMessage?.createdAt
                      ? formatDate(conversation.lastMessage.createdAt, 'MMM dd, hh:mm a')
                      : formatDate(conversation.updatedAt, 'MMM dd, hh:mm a')}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );

  const ChatPane = () => {
    const otherUser = selectedConversation ? getOtherParticipant(selectedConversation, user?.id) : undefined;
    const displayName = [otherUser?.firstName, otherUser?.lastName].filter(Boolean).join(' ') || otherUser?.email || 'Conversation';

    return (
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-4 lg:px-6 py-4 flex items-center gap-3">
          <button
            className="lg:hidden p-1 rounded-full hover:bg-muted mr-1"
            onClick={() => setSelectedConversationId(null)}
            aria-label="Back to conversations"
            title="Back to conversations"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {otherUser?.avatar ? (
            <img src={otherUser.avatar} alt={displayName} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
              {getInitials(otherUser?.firstName || 'C', otherUser?.lastName || 'U')}
            </div>
          )}
          <div>
            <p className="font-semibold">{displayName}</p>
            <p className="text-sm text-muted-foreground">Conversation</p>
          </div>
        </div>

        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4">
            {messagesQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading messages...</p>
            )}

            {!messagesQuery.isLoading && messages.length === 0 && (
              <p className="text-sm text-muted-foreground">No messages in this conversation yet.</p>
            )}

            {messages.map((message) => {
              const isSent = message.senderId === user?.id;
              return (
                <div key={message.id} className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                  <div className="space-y-1 max-w-[70%]">
                    <div className={`rounded-2xl px-4 py-2 ${isSent ? 'bg-primary text-white' : 'bg-muted'}`}>
                      <p className="text-sm">{message.content}</p>
                      <p className={`text-xs mt-1 ${isSent ? 'text-white/70' : 'text-muted-foreground'}`}>
                        {formatDate(message.createdAt, 'hh:mm a')}
                      </p>
                    </div>
                    {!isSent && isAuthenticated && (
                      <ReportDialog
                        triggerLabel="Report message"
                        triggerVariant="ghost"
                        defaultContentType="message"
                        reportedMessageId={message.id}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-4">
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="icon" disabled><ImageIcon className="w-5 h-5" /></Button>
            <Button variant="ghost" size="icon" disabled><Paperclip className="w-5 h-5" /></Button>
            <Input
              placeholder="Type a message..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1"
            />
            <Button onClick={handleSendMessage} size="icon" disabled={sendMessageMutation.isPending || !messageInput.trim()}>
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-1 flex overflow-hidden">
        <div className={`${showChat ? 'hidden lg:flex' : 'flex'} w-full lg:w-80`}>
          <ConversationList />
        </div>

        {showChat ? (
          <ChatPane />
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center text-muted-foreground">
            <p>Select a conversation to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}