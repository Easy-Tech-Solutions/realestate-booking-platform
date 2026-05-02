import type { HostStats } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import type { DashboardFavoriteResponse, DashboardResponse } from './shared/contracts';
import { normalizeBooking, normalizeListing } from './shared/normalizers';

export const dashboardAPI = {
  getMyDashboard: async () => {
    const data = await fetchWithAuth<DashboardResponse>('/api/users/me/dashboard/');
    return {
      ...data,
      listings: (data.listings || []).map(normalizeListing),
      bookings_as_customer: (data.bookings_as_customer || []).map(normalizeBooking),
      bookings_on_my_listings: (data.bookings_on_my_listings || []).map(normalizeBooking),
      favorites: (data.favorites || []).map((favorite: DashboardFavoriteResponse) => ({
        ...favorite,
        listing: favorite.listing ? normalizeListing(favorite.listing) : undefined,
      })),
    };
  },

  getAgentAnalytics: async (days = 30): Promise<HostStats> => {
    const data = await fetchWithAuth<DashboardResponse>(`/api/listings/analytics/agent/?days=${days}`);
    return {
      totalEarnings: parseFloat(data.summary?.total_revenue || '0'),
      monthlyEarnings: 0,
      totalBookings: data.summary?.total_bookings || 0,
      activeListings: data.summary?.total_listings || 0,
      averageRating: 0,
      responseRate: 0,
      acceptanceRate: 0,
      upcomingBookings: [],
      recentReviews: [],
    };
  },
};