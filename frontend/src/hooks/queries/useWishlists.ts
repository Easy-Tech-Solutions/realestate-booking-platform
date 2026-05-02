import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function useFavoriteProperties(enabled = true) {
  return useQuery({
    queryKey: queryKeys.properties.favorites,
    queryFn: () => propertiesAPI.getFavorites(),
    enabled,
  });
}