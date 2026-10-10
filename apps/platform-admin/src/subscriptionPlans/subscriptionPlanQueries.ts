import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SubscriptionPlanResponse = components['schemas']['SubscriptionPlanResponseDto'];
export type CreateSubscriptionPlanInput = components['schemas']['CreateSubscriptionPlanDto'];
export type UpdateSubscriptionPlanInput = components['schemas']['UpdateSubscriptionPlanDto'];

/** GET /platform-admin/subscription-plans (Phase 55) — not the tenant-facing
 * GET /plans (that one's JwtAuthGuard-gated, not reusable from this Cognito-backed
 * realm; see PlatformAdminSubscriptionPlansController's own header comment).
 * Cursor-based (Decision 22/70); this page owns accumulating pages into one list,
 * same "Load more" pattern TranslationsPage already established. */
export function useSubscriptionPlans(cursor: string | null) {
  return useQuery({
    queryKey: ['subscription-plans', cursor],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/subscription-plans', { params: { query: { cursor: cursor ?? undefined } } })),
  });
}

export function useCreateSubscriptionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriptionPlanInput) => unwrap(apiClient.POST('/v1/platform-admin/subscription-plans', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscription-plans'] }),
  });
}

export function useUpdateSubscriptionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSubscriptionPlanInput }) =>
      unwrap(apiClient.PATCH('/v1/platform-admin/subscription-plans/{id}', { params: { path: { id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subscription-plans'] }),
  });
}
