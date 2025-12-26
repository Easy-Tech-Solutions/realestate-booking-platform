// Centralized endpoint paths to keep Express and Python backends aligned
export const endpoints = {
  auth: {
    login: '/api/auth/login',
    register: '/api/auth/register',
    me: '/api/auth/me',
  },
  listings: {
    base: '/api/listings',
    byId: (id) => `/api/listings/${id}`,
    favorite: (id) => `/api/listings/${id}/favorite`,
  },
  bookings: {
    base: '/api/bookings',
    byId: (id) => `/api/bookings/${id}`,
  },
  users: {
    base: '/api/users',
    byId: (id) => `/api/users/${id}`,
  },
}
