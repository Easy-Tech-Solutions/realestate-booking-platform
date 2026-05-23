import type { Property, Review, SearchFilters, HotelRoom, HotelRoomAvailability, HotelRoomImage } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { buildSearchParams, normalizeListing, normalizeReview, normalizeHotelRoom, normalizeHotelRoomAvailability } from './shared/normalizers';
import type { AvailabilityResponse, ListingPricingResponse } from './shared/contracts';

export const propertiesAPI = {
  getAll: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown>('/api/listings/?ordering=-created_at');
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  search: async (filters: SearchFilters): Promise<Property[]> => {
    const params = buildSearchParams(filters);
    const data = await fetchWithAuth<unknown>(`/api/listings/?${params}`);
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  getById: async (id: string): Promise<Property> => {
    const data = await fetchWithAuth(`/api/listings/${id}/`);
    return normalizeListing(data);
  },

  getFeatured: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<{ popular_listings?: unknown[] }>('/api/listings/analytics/popular/');
    const popularListings = (data.popular_listings || []).map(normalizeListing);

    if (popularListings.length > 0) {
      return popularListings;
    }

    const fallback = await fetchWithAuth<unknown[]>('/api/listings/');
    return fallback.map(normalizeListing);
  },

  getByCategory: async (category: string): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown>(`/api/listings/?property_type=${encodeURIComponent(category)}`);
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  listCategories: async (): Promise<Array<{ id: number; name: string; slug: string; is_active: boolean; sort_order: number }>> => {
    return fetchWithAuth('/api/listings/categories/');
  },

  createCategory: async (payload: { name: string; slug: string; is_active?: boolean; sort_order?: number }) => {
    return fetchWithAuth('/api/listings/categories/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateCategory: async (id: number, payload: Partial<{ name: string; slug: string; is_active: boolean; sort_order: number }>) => {
    return fetchWithAuth(`/api/listings/categories/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteCategory: async (id: number): Promise<void> => {
    await fetchWithAuth(`/api/listings/categories/${id}/`, { method: 'DELETE' });
  },

  create: async (formData: FormData): Promise<Property> => {
    const data = await fetchWithAuth('/api/listings/', {
      method: 'POST',
      body: formData,
    });
    return normalizeListing(data);
  },

  addGalleryImage: async (listingId: string, file: File, caption = '', order = 0): Promise<any> => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('caption', caption);
    formData.append('order', String(order));
    return fetchWithAuth(`/api/listings/${listingId}/images/`, {
      method: 'POST',
      body: formData,
    });
  },

  deleteGalleryImage: async (listingId: string, imageId: number): Promise<void> => {
    await fetchWithAuth(`/api/listings/${listingId}/images/${imageId}/`, { method: 'DELETE' });
  },

  update: async (id: string, formData: FormData): Promise<Property> => {
    const data = await fetchWithAuth(`/api/listings/${id}/`, {
      method: 'PUT',
      body: formData,
    });
    return normalizeListing(data);
  },

  delete: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/`, { method: 'DELETE' });
  },

  getReviews: async (id: string): Promise<Review[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/listings/${id}/reviews/`);
    return data.map(normalizeReview);
  },

  createReview: async (payload: {
    listing: string;
    rating: number;
    title: string;
    content: string;
    cleanliness: number;
    accuracy: number;
    check_in_rating: number;
    communication: number;
    location_rating: number;
    value: number;
  }): Promise<Review> => {
    const data = await fetchWithAuth('/api/listings/reviews/create/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeReview(data);
  },

  toggleFavorite: async (id: string, isFavorited: boolean): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/favorite/`, {
      method: isFavorited ? 'DELETE' : 'POST',
    });
  },

  getFavorites: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<Array<{ listing: unknown }>>('/api/listings/favorites/');
    return data.map((favorite: any) => normalizeListing(favorite.listing));
  },

  getAvailability: async (id: string): Promise<string[]> => {
    const data = await fetchWithAuth<AvailabilityResponse>(`/api/listings/${id}/availability/`);
    return data.booked_dates || [];
  },

  calculatePricing: async (id: string, startDate: string, endDate: string, roomId?: string): Promise<{
    nights: number;
    subtotal: number;
    discount: number;
    discountLabel: string | null;
    discountedSubtotal: number;
    cleaningFee: number;
    serviceFee: number;
    taxes: number;
    total: number;
  }> => {
    let url = `/api/listings/${id}/pricing/?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    if (roomId) url += `&room_id=${encodeURIComponent(roomId)}`;
    const data = await fetchWithAuth<ListingPricingResponse>(url);
    return {
      nights: data.nights,
      subtotal: data.subtotal,
      discount: data.discount,
      discountLabel: data.discount_label,
      discountedSubtotal: data.discounted_subtotal,
      cleaningFee: data.cleaning_fee,
      serviceFee: data.service_fee,
      taxes: data.taxes,
      total: data.total,
    };
  },

  getByHost: async (hostId: string): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown>(`/api/listings/?owner_id=${encodeURIComponent(hostId)}`);
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  getFullDetails: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/listings/${id}/`);
  },

  getPlatformStats: async (): Promise<{ total_properties: number; total_locations: number; happy_guests: number }> => {
    return fetchWithAuth('/api/listings/analytics/platform-stats/');
  },

  getMyDrafts: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/listings/my-drafts/');
    return data.map(normalizeListing);
  },

  getNearby: async (lat: number, lng: number, radius = 50): Promise<(Property & { distanceKm: number })[]> => {
    const data = await fetchWithAuth<any[]>(
      `/api/listings/nearby/?lat=${lat}&lng=${lng}&radius=${radius}`
    );
    return data.map((item) => ({ ...normalizeListing(item), distanceKm: item.distance_km ?? 0 }));
  },

  getRooms: async (listingId: string): Promise<HotelRoom[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/listings/${listingId}/rooms/`);
    return data.map(normalizeHotelRoom);
  },

  createRoom: async (listingId: string, payload: Partial<HotelRoom>): Promise<HotelRoom> => {
    const body = {
      listing: listingId,
      name: payload.name,
      room_type: payload.roomType,
      description: payload.description,
      price_per_night: payload.pricePerNight,
      max_occupancy: payload.maxOccupancy,
      beds: payload.beds,
      bed_type: payload.bedType,
      bathrooms: payload.bathrooms,
      amenities: payload.amenities,
      total_count: payload.totalCount,
      is_active: payload.isActive ?? true,
    };
    const data = await fetchWithAuth(`/api/listings/${listingId}/rooms/`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return normalizeHotelRoom(data);
  },

  updateRoom: async (listingId: string, roomId: string, payload: Partial<HotelRoom>): Promise<HotelRoom> => {
    const body: Record<string, any> = {};
    if (payload.name !== undefined) body.name = payload.name;
    if (payload.roomType !== undefined) body.room_type = payload.roomType;
    if (payload.description !== undefined) body.description = payload.description;
    if (payload.pricePerNight !== undefined) body.price_per_night = payload.pricePerNight;
    if (payload.maxOccupancy !== undefined) body.max_occupancy = payload.maxOccupancy;
    if (payload.beds !== undefined) body.beds = payload.beds;
    if (payload.bedType !== undefined) body.bed_type = payload.bedType;
    if (payload.bathrooms !== undefined) body.bathrooms = payload.bathrooms;
    if (payload.amenities !== undefined) body.amenities = payload.amenities;
    if (payload.totalCount !== undefined) body.total_count = payload.totalCount;
    if (payload.isActive !== undefined) body.is_active = payload.isActive;
    const data = await fetchWithAuth(`/api/listings/${listingId}/rooms/${roomId}/`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return normalizeHotelRoom(data);
  },

  deleteRoom: async (listingId: string, roomId: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/${listingId}/rooms/${roomId}/`, { method: 'DELETE' });
  },

  uploadRoomImage: async (listingId: string, roomId: string, file: File, caption = ''): Promise<HotelRoomImage> => {
    const form = new FormData();
    form.append('image', file);
    if (caption) form.append('caption', caption);
    const data = await fetchWithAuth<any>(`/api/listings/${listingId}/rooms/${roomId}/images/`, {
      method: 'POST',
      body: form,
    });
    return { id: String(data.id), imageUrl: data.image_url || data.image || '', caption: data.caption || '', order: Number(data.order || 0) };
  },

  deleteRoomImage: async (listingId: string, roomId: string, imageId: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/${listingId}/rooms/${roomId}/images/${imageId}/`, { method: 'DELETE' });
  },

  getRoomAvailability: async (listingId: string, startDate: string, endDate: string): Promise<HotelRoomAvailability[]> => {
    const data = await fetchWithAuth<unknown[]>(
      `/api/listings/${listingId}/rooms/availability/?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
    );
    return data.map(normalizeHotelRoomAvailability);
  },

  // Admin: listing verification
  getPendingReview: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<any[]>('/api/listings/pending-review/');
    return data.map(normalizeListing);
  },

  approveListing: async (id: string): Promise<Property> => {
    const data = await fetchWithAuth<any>(`/api/listings/${id}/approve/`, { method: 'POST' });
    return normalizeListing(data);
  },

  rejectListing: async (id: string, reason?: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/reject/`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || '' }),
    });
  },

  getMyListings: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<any[]>('/api/listings/my-listings/');
    return data.map(normalizeListing);
  },
};
