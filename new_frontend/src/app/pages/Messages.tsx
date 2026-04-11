import React, { useState } from 'react';
import { Send, Image as ImageIcon, Paperclip, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { formatDate } from '../../core/utils';

const conversations = [
  {
    id: '1',
    user: {
      name: 'Sarah Smith',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    },
    lastMessage: 'Great! Looking forward to hosting you',
    timestamp: '2026-03-19T10:30:00Z',
    unread: 2,
  },
  {
    id: '2',
    user: {
      name: 'Mike Johnson',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    },
    lastMessage: 'Thanks for the quick response!',
    timestamp: '2026-03-18T15:20:00Z',
    unread: 0,
  },
];

const messages = [
  { id: '1', senderId: '2', content: 'Hi! I have a question about the property', timestamp: '2026-03-19T09:00:00Z' },
  { id: '2', senderId: '1', content: 'Of course! How can I help?', timestamp: '2026-03-19T09:15:00Z' },
  { id: '3', senderId: '2', content: 'Is parking included?', timestamp: '2026-03-19T09:20:00Z' },
  { id: '4', senderId: '1', content: 'Yes! Free parking is available for up to 2 vehicles', timestamp: '2026-03-19T10:00:00Z' },
  { id: '5', senderId: '2', content: 'Great! Looking forward to hosting you', timestamp: '2026-03-19T10:30:00Z' },
];

export function Messages() {
  const [selectedConversation, setSelectedConversation] = useState<typeof conversations[0] | null>(null);
  const [messageInput, setMessageInput] = useState('');
  // On mobile: null = show list, conversation = show chat
  const showChat = selectedConversation !== null;

  const handleSendMessage = () => {
    if (messageInput.trim()) {
      setMessageInput('');
    }
  };

  const ConversationList = () => (
    <div className="w-full lg:w-80 border-r border-border flex flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-semibold">Messages</h1>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedConversation(conv)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left ${
                selectedConversation?.id === conv.id ? 'bg-muted' : ''
              }`}
            >
              <img src={conv.user.avatar} alt={conv.user.name} className="w-12 h-12 rounded-full object-cover" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold truncate">{conv.user.name}</p>
                  {conv.unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center flex-shrink-0">
                      {conv.unread}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(conv.timestamp, 'MMM dd, hh:mm a')}</p>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const ChatPane = () => (
    <div className="flex-1 flex flex-col">
      {/* Chat Header */}
      <div className="border-b border-border px-4 lg:px-6 py-4 flex items-center gap-3">
        <button
          className="lg:hidden p-1 rounded-full hover:bg-muted mr-1"
          onClick={() => setSelectedConversation(null)}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <img
          src={selectedConversation!.user.avatar}
          alt={selectedConversation!.user.name}
          className="w-10 h-10 rounded-full object-cover"
        />
        <div>
          <p className="font-semibold">{selectedConversation!.user.name}</p>
          <p className="text-sm text-muted-foreground">Active now</p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-6">
        <div className="space-y-4">
          {messages.map((message) => {
            const isSent = message.senderId === '1';
            return (
              <div key={message.id} className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${isSent ? 'bg-primary text-white' : 'bg-muted'}`}>
                  <p className="text-sm">{message.content}</p>
                  <p className={`text-xs mt-1 ${isSent ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {formatDate(message.timestamp, 'hh:mm a')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex items-end gap-2">
          <Button variant="ghost" size="icon"><ImageIcon className="w-5 h-5" /></Button>
          <Button variant="ghost" size="icon"><Paperclip className="w-5 h-5" /></Button>
          <Input
            placeholder="Type a message..."
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            className="flex-1"
          />
          <Button onClick={handleSendMessage} size="icon"><Send className="w-5 h-5" /></Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile: show list OR chat. Desktop: show both */}
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
