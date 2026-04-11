import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Property } from '../../core/types';
import { dashboardAPI, messagesAPI, propertiesAPI, reviewsAPI } from '../../services/api.service';
import { queryKeys } from './keys';

export function useHostDashboardData() {
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard.me,
    queryFn: () => dashboardAPI.getMyDashboard(),
  });

  const conversationsQuery = useQuery({
    queryKey: queryKeys.messages.conversations,
    queryFn: () => messagesAPI.getConversations(),
  });

  const properties = (dashboardQuery.data?.listings || []) as Property[];

  const reviewQueries = useQueries({
    queries: properties.map((property) => ({
      queryKey: queryKeys.properties.reviews(property.id),
      queryFn: () => reviewsAPI.getByProperty(property.id),
      enabled: dashboardQuery.isSuccess,
    })),
  });

  const reviews = reviewQueries.flatMap((query) => query.data || []);
  const isReviewsLoading = reviewQueries.some((query) => query.isLoading);

  return {
    dashboardQuery,
    conversationsQuery,
    reviews,
    isReviewsLoading,
  };
}

export function useUpdateHostProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: FormData }) => propertiesAPI.update(id, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.me });
    },
  });
}

export function useDeleteHostProperty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => propertiesAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.me });
    },
  });
}

export function useRespondToHostReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, response }: { id: string; response: string }) => reviewsAPI.respond(id, response),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.me });
      queryClient.invalidateQueries({ queryKey: ['properties', 'reviews'] });
    },
  });
}