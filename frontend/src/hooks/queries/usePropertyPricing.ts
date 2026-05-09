import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function usePropertyPricing(propertyId?: string, startDate?: string, endDate?: string, roomId?: string) {
  return useQuery({
    queryKey: propertyId && startDate && endDate
      ? [...queryKeys.properties.pricing(propertyId, startDate, endDate), roomId || '']
      : ['properties', 'pricing', 'empty'],
    queryFn: () => propertiesAPI.calculatePricing(propertyId!, startDate!, endDate!, roomId),
    enabled: Boolean(propertyId && startDate && endDate),
  });
}