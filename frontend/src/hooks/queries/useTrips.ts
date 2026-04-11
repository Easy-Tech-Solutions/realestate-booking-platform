import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Booking, Property } from '../../core/types';
import { bookingsAPI, propertiesAPI, reviewsAPI } from '../../services/api.service';
import { queryKeys } from './keys';

const DEFAULT_PROPERTY_IMAGE =
  'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=500&fit=crop';

export interface TripItem {
  booking: Booking;
  property: Property;
  estimatedTotal: number;
}

function ensureTripProperty(property: Property): Property {
  if (property.images.length > 0) {
    return property;
  }

  return {
    ...property,
    images: [DEFAULT_PROPERTY_IMAGE],
  };
}

export function useUserTrips(enabled: boolean) {
  const queryClient = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: queryKeys.bookings.user,
    queryFn: () => bookingsAPI.getUserBookings(),
    enabled,
  });

  const bookings = useMemo(() => bookingsQuery.data || [], [bookingsQuery.data]);

  const propertyIds = useMemo(
    () => [...new Set(bookings.map((booking) => booking.propertyId).filter(Boolean))],
    [bookings]
  );

  const propertyQueries = useQueries({
    queries: propertyIds.map((id) => ({
      queryKey: queryKeys.properties.detail(id),
      queryFn: () => propertiesAPI.getById(id),
      enabled,
    })),
  });

  const propertyById = useMemo(() => {
    const map = new Map<string, Property>();
    for (const query of propertyQueries) {
      if (query.data) {
        map.set(query.data.id, ensureTripProperty(query.data));
      }
    }
    return map;
  }, [propertyQueries]);

  const trips = useMemo<TripItem[]>(() => {
    return bookings.map((booking) => {
      const property = propertyById.get(booking.propertyId) || ensureTripProperty(booking.property);
      const checkInDate = new Date(booking.checkIn);
      const checkOutDate = new Date(booking.checkOut);
      const nights = Math.max(
        1,
        Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
      );

      return {
        booking,
        property,
        estimatedTotal:
          booking.totalPrice > 0 ? booking.totalPrice : Math.round(Math.max(0, property.price) * nights),
      };
    });
  }, [bookings, propertyById]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingTrips = trips.filter(({ booking }) => {
    const checkOutDate = new Date(booking.checkOut);
    return booking.status !== 'cancelled' && booking.status !== 'completed' && checkOutDate >= today;
  });

  const pastTrips = trips.filter(({ booking }) => {
    const checkOutDate = new Date(booking.checkOut);
    return booking.status === 'cancelled' || booking.status === 'completed' || checkOutDate < today;
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) => bookingsAPI.cancel(bookingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.user });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.me });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ listingId, rating, content }: { listingId: string; rating: number; content: string }) =>
      reviewsAPI.create({
        listing: listingId,
        rating,
        content,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.properties.reviews(variables.listingId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings.user });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.me });
    },
  });

  return {
    trips,
    upcomingTrips,
    pastTrips,
    isLoading: bookingsQuery.isLoading || propertyQueries.some((query) => query.isLoading),
    isError: bookingsQuery.isError,
    cancelMutation,
    reviewMutation,
  };
}
