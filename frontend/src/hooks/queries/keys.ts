export const queryKeys = {
  properties: {
    detail: (id: string) => ['properties', 'detail', id] as const,
    reviews: (id: string) => ['properties', 'reviews', id] as const,
    availability: (id: string) => ['properties', 'availability', id] as const,
    pricing: (id: string, startDate: string, endDate: string) => ['properties', 'pricing', id, startDate, endDate] as const,
    favorites: ['properties', 'favorites'] as const,
    byHost: (id: string) => ['properties', 'host', id] as const,
  },
  users: {
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  messages: {
    conversations: ['messages', 'conversations'] as const,
    thread: (id: string) => ['messages', 'thread', id] as const,
  },
  bookings: {
    user: ['bookings', 'user'] as const,
    detail: (id: string) => ['bookings', 'detail', id] as const,
  },
  dashboard: {
    me: ['dashboard', 'me'] as const,
  },
};