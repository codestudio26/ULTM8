import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CardSurchargeSettings = components['schemas']['CardSurchargeSettingsDto'];
export type UpdateCardSurchargeInput = components['schemas']['UpdateCardSurchargeSettingsDto'];

/** GET /schools/:id/card-surcharge (Decision 406) — the owner's setting, and
 * whether the School's country allows it at all. */
export function useCardSurcharge(schoolId: string) {
  return useQuery({
    queryKey: ['card-surcharge', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/card-surcharge', { params: { path: { schoolId } } })),
  });
}

export function useUpdateCardSurcharge(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCardSurchargeInput) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/card-surcharge', { params: { path: { schoolId } }, body })),
    onSuccess: (data) => queryClient.setQueryData(['card-surcharge', schoolId], data),
  });
}
