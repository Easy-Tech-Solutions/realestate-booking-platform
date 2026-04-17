import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../../services/api.service';

export function useHomeProperties(selectedCategory: string | null) {
  return useQuery({
    queryKey: ['home', 'properties', selectedCategory || 'all'],
    queryFn: () => selectedCategory
      ? propertiesAPI.getByCategory(selectedCategory)
      : propertiesAPI.getAll(),
  });
}