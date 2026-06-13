import { fetchPublicJson, fetchWithAuth } from './shared/client';

export interface SupportTicket {
  id: number;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'pending_user' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requesterName: string;
  requesterEmail: string;
  assignedToName: string | null;
  messageCount: number;
  messages?: TicketMessage[];
  attachments?: TicketAttachment[];
  conversationId?: number | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface TicketMessage {
  id: number;
  senderName: string;
  isStaffReply: boolean;
  content: string;
  createdAt: string;
}

export interface TicketAttachment {
  id: number;
  filename: string;
  fileUrl: string;
  fileSize: number;
  contentType: string;
}

export interface ContactInquiry {
  id: number;
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface SearchResult {
  id: number;
  ticketNumber: string;
  subject: string;
  category: string;
  resolvedAt: string;
}

function normalizeTicket(d: any): SupportTicket {
  return {
    id: d.id,
    ticketNumber: d.ticket_number,
    category: d.category,
    subject: d.subject,
    description: d.description,
    status: d.status,
    priority: d.priority,
    requesterName: d.requester_name,
    requesterEmail: d.requester_email,
    assignedToName: d.assigned_to_name,
    messageCount: d.message_count ?? 0,
    conversationId: d.conversation_id ?? null,
    messages: d.messages?.map((m: any) => ({
      id: m.id,
      senderName: m.sender_name,
      isStaffReply: m.is_staff_reply,
      content: m.content,
      createdAt: m.created_at,
    })),
    attachments: d.attachments?.map((a: any) => ({
      id: a.id,
      filename: a.filename,
      fileUrl: a.file_url,
      fileSize: a.file_size,
      contentType: a.content_type,
    })),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    resolvedAt: d.resolved_at,
  };
}

export const supportAPI = {
  submitContact: async (payload: {
    name: string;
    email: string;
    category: string;
    subject: string;
    message: string;
  }) =>
    fetchPublicJson<{ message: string; id: number; conversation_id: number | null }>('/api/support/contact/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  searchTickets: async (q: string): Promise<SearchResult[]> => {
    const data = await fetchPublicJson<any[]>(
      `/api/support/search/?q=${encodeURIComponent(q)}`
    );
    return data.map((d) => ({
      id: d.id,
      ticketNumber: d.ticket_number,
      subject: d.subject,
      category: d.category,
      resolvedAt: d.resolved_at,
    }));
  },

  createTicket: async (formData: FormData): Promise<SupportTicket> => {
    const data = await fetchWithAuth<any>('/api/support/tickets/', {
      method: 'POST',
      body: formData,
      headers: {},
    });
    return normalizeTicket(data);
  },

  createGuestTicket: async (formData: FormData): Promise<SupportTicket> => {
    const data = await fetchPublicJson<any>('/api/support/tickets/', {
      method: 'POST',
      body: formData,
      headers: {},
    });
    return normalizeTicket(data);
  },

  getTickets: async (): Promise<SupportTicket[]> => {
    const data = await fetchWithAuth<any[]>('/api/support/tickets/');
    return data.map(normalizeTicket);
  },

  getTicket: async (id: number): Promise<SupportTicket> => {
    const data = await fetchWithAuth<any>(`/api/support/tickets/${id}/`);
    return normalizeTicket(data);
  },

  addMessage: async (ticketId: number, content: string): Promise<TicketMessage> => {
    const data = await fetchWithAuth<any>(
      `/api/support/tickets/${ticketId}/messages/`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      }
    );
    return {
      id: data.id,
      senderName: data.sender_name,
      isStaffReply: data.is_staff_reply,
      content: data.content,
      createdAt: data.created_at,
    };
  },

  // Admin
  adminGetTickets: async (
    params?: Record<string, string>
  ): Promise<{ count: number; results: SupportTicket[] }> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const data = await fetchWithAuth<any>(`/api/support/admin/tickets/${qs}`);
    return { count: data.count, results: data.results.map(normalizeTicket) };
  },

  adminUpdateTicket: async (
    id: number,
    payload: Record<string, any>
  ): Promise<SupportTicket> => {
    const data = await fetchWithAuth<any>(`/api/support/admin/tickets/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return normalizeTicket(data);
  },

  adminGetContacts: async (
    params?: Record<string, string>
  ): Promise<ContactInquiry[]> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const data = await fetchWithAuth<any[]>(`/api/support/admin/contact/${qs}`);
    return data.map((d) => ({
      id: d.id,
      name: d.name,
      email: d.email,
      category: d.category,
      subject: d.subject,
      message: d.message,
      isRead: d.is_read,
      createdAt: d.created_at,
    }));
  },

  adminMarkContactRead: async (id: number): Promise<void> => {
    await fetchWithAuth(`/api/support/admin/contact/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ is_read: true }),
    });
  },

  adminGetStats: async () => {
    return fetchWithAuth<{
      open: number;
      in_progress: number;
      pending_user: number;
      resolved: number;
      closed: number;
      total: number;
      unread_contact: number;
    }>('/api/support/admin/stats/');
  },
};
