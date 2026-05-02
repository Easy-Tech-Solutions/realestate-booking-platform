import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Booking, Property } from '../../core/types';
import { bookingsAPI, propertiesAPI } from '../../services/api.service';
import { queryKeys } from './keys';

const DEFAULT_PROPERTY_IMAGE =
  'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=500&fit=crop';

function ensurePropertyImage(property: Property): Property {
  if (property.images.length > 0) {
    return property;
  }

  return {
    ...property,
    images: [DEFAULT_PROPERTY_IMAGE],
  };
}

export function useBookingConfirmedData(bookingId?: string, initialBooking?: Booking) {
  const bookingQuery = useQuery({
    queryKey: queryKeys.bookings.detail(bookingId || ''),
    queryFn: () => bookingsAPI.getById(bookingId || ''),
    enabled: Boolean(bookingId),
    initialData: initialBooking,
  });

  const propertyId = bookingQuery.data?.propertyId;

  const propertyQuery = useQuery({
    queryKey: queryKeys.properties.detail(propertyId || ''),
    queryFn: () => propertiesAPI.getById(propertyId || ''),
    enabled: Boolean(propertyId),
  });

  const booking = useMemo(() => {
    const value = bookingQuery.data;
    if (!value) {
      return null;
    }

    if (!propertyQuery.data) {
      return {
        ...value,
        property: ensurePropertyImage(value.property),
      };
    }

    return {
      ...value,
      property: ensurePropertyImage(propertyQuery.data),
    };
  }, [bookingQuery.data, propertyQuery.data]);

  return {
    booking,
    isLoading: bookingQuery.isLoading || propertyQuery.isLoading,
    isError: bookingQuery.isError,
  };
}
