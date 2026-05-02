import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function usePropertyPricing(propertyId?: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: propertyId && startDate && endDate
      ? queryKeys.properties.pricing(propertyId, startDate, endDate)
      : ['properties', 'pricing', 'empty'],
    queryFn: () => propertiesAPI.calculatePricing(propertyId!, startDate!, endDate!),
    enabled: Boolean(propertyId && startDate && endDate),
  });
}