import { useQueries, useQuery } from '@tanstack/react-query';
import { propertiesAPI, reviewsAPI, usersAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function useHostProfile(hostId?: string) {
  const userQuery = useQuery({
    queryKey: hostId ? queryKeys.users.detail(hostId) : ['users', 'detail', 'empty'],
    queryFn: () => usersAPI.getById(hostId!),
    enabled: Boolean(hostId),
  });

  const propertiesQuery = useQuery({
    queryKey: hostId ? queryKeys.properties.byHost(hostId) : ['properties', 'host', 'empty'],
    queryFn: () => propertiesAPI.getByHost(hostId!),
    enabled: Boolean(hostId),
  });

  const reviewQueries = useQueries({
    queries: (propertiesQuery.data || []).map((property) => ({
      queryKey: queryKeys.properties.reviews(property.id),
      queryFn: () => reviewsAPI.getByProperty(property.id),
      enabled: propertiesQuery.isSuccess,
    })),
  });

  const reviews = reviewQueries.flatMap((query) => query.data || []);
  const isReviewsLoading = reviewQueries.some((query) => query.isLoading);

  return {
    userQuery,
    propertiesQuery,
    reviews,
    isReviewsLoading,
  };
}