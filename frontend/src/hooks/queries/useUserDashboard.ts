import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Booking, Property, Review } from '../../core/types';
import { dashboardAPI, propertiesAPI, reviewsAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export interface DashboardTrip {
  booking: Booking;
  property: Property;
  estimatedTotal: number;
}

export interface DashboardReview {
  review: Review;
  propertyTitle: string;
}

const DEFAULT_PROPERTY_IMAGE =
  'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=500&fit=crop';

function withFallbackImage(property: Property): Property {
  if (property.images.length > 0) {
    return property;
  }
  return {
    ...property,
    images: [DEFAULT_PROPERTY_IMAGE],
  };
}

export function useUserDashboardData(userId?: string, enabled = true) {
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard.me,
    queryFn: () => dashboardAPI.getMyDashboard(),
    enabled,
  });

  const bookings = useMemo(
    () => ((dashboardQuery.data?.bookings_as_customer || []) as Booking[]),
    [dashboardQuery.data?.bookings_as_customer]
  );
  const favoriteProperties = ((dashboardQuery.data?.favorites || []) as Array<{ listing?: Property }>)
    .map((favorite) => favorite.listing)
    .filter(Boolean)
    .map((property) => withFallbackImage(property as Property));

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

  const reviewsQueries = useQueries({
    queries: propertyIds.map((id) => ({
      queryKey: queryKeys.properties.reviews(id),
      queryFn: () => reviewsAPI.getByProperty(id),
      enabled,
    })),
  });

  const propertyById = useMemo(() => {
    const map = new Map<string, Property>();
    for (const query of propertyQueries) {
      if (query.data) {
        map.set(query.data.id, withFallbackImage(query.data));
      }
    }
    return map;
  }, [propertyQueries]);

  const trips = useMemo(() => {
    return bookings.map<DashboardTrip>((booking) => {
      const property = propertyById.get(booking.propertyId) || withFallbackImage(booking.property);
      const checkInDate = new Date(booking.checkIn);
      const checkOutDate = new Date(booking.checkOut);
      const nights = Math.max(1, Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)));
      const estimatedTotal = booking.totalPrice > 0
        ? booking.totalPrice
        : Math.round(Math.max(0, property.price) * nights);

      return {
        booking,
        property,
        estimatedTotal,
      };
    });
  }, [bookings, propertyById]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingTrips = trips.filter(({ booking }) => {
    const checkOut = new Date(booking.checkOut);
    return booking.status !== 'cancelled' && booking.status !== 'completed' && checkOut >= today;
  });

  const pastTrips = trips.filter(({ booking }) => {
    const checkOut = new Date(booking.checkOut);
    return booking.status === 'cancelled' || booking.status === 'completed' || checkOut < today;
  });

  const reviewPool = reviewsQueries.flatMap((query) => query.data || []) as Review[];
  const userReviews = useMemo<DashboardReview[]>(() => {
    if (!userId) {
      return [];
    }

    return reviewPool
      .filter((review) => review.userId === userId)
      .map((review) => ({
        review,
        propertyTitle: propertyById.get(review.propertyId)?.title || 'Property',
      }));
  }, [reviewPool, userId, propertyById]);

  const totalSpent = trips.reduce((sum, trip) => sum + trip.estimatedTotal, 0);
  const isLoading = dashboardQuery.isLoading || propertyQueries.some((query) => query.isLoading);

  return {
    dashboardQuery,
    upcomingTrips,
    pastTrips,
    favoriteProperties,
    userReviews,
    totalSpent,
    isLoading,
  };
}
