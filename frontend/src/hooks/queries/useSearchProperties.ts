import { useQuery } from '@tanstack/react-query';
import type { SearchFilters } from '../../core/types';
import { propertiesAPI } from '../../services/api.service';

export function useSearchProperties(searchFilters: SearchFilters) {
  return useQuery({
    queryKey: ['properties', 'search', searchFilters],
    queryFn: () => propertiesAPI.search(searchFilters),
  });
}