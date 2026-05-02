import { useQuery } from '@tanstack/react-query';
import { propertiesAPI, reviewsAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function usePropertyDetails(propertyId?: string) {
  const propertyQuery = useQuery({
    queryKey: propertyId ? queryKeys.properties.detail(propertyId) : ['properties', 'detail', 'empty'],
    queryFn: () => propertiesAPI.getById(propertyId!),
    enabled: Boolean(propertyId),
  });

  const reviewsQuery = useQuery({
    queryKey: propertyId ? queryKeys.properties.reviews(propertyId) : ['properties', 'reviews', 'empty'],
    queryFn: () => reviewsAPI.getByProperty(propertyId!),
    enabled: Boolean(propertyId),
  });

  const availabilityQuery = useQuery({
    queryKey: propertyId ? queryKeys.properties.availability(propertyId) : ['properties', 'availability', 'empty'],
    queryFn: () => propertiesAPI.getAvailability(propertyId!),
    enabled: Boolean(propertyId),
  });

  return {
    propertyQuery,
    reviewsQuery,
    availabilityQuery,
  };
}