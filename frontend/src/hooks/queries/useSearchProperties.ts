import { useQuery } from '@tanstack/react-query';
import type { SearchFilters } from '../../core/types';
import { propertiesAPI } from '../../services/api.service';

export function useSearchProperties(searchFilters: SearchFilters) {
  const hasFilters = Boolean(
    searchFilters.location || searchFilters.guests || searchFilters.checkIn ||
    searchFilters.priceMin || searchFilters.priceMax || searchFilters.propertyType?.length
  );
  return useQuery({
    queryKey: ['properties', 'search', searchFilters],
    queryFn: () => propertiesAPI.search(searchFilters),
    enabled: hasFilters,
  });
}