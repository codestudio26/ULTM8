import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CloseTenantAccountInput = components['schemas']['CloseTenantAccountDto'];

/** Phase 57 (Decision 110/Phase 56) — the close/reactivate mutations for
 * TenantLifecycleModule. Both School and Franchise share the exact same
 * shape (POST .../close with a re-typed-name confirmation body, POST
 * .../reactivate with none) — one pair of hooks parameterized by entity kind
 * rather than four near-duplicate ones. Invalidates the entity's own
 * look-up query (`platform-admin-school`/`platform-admin-franchise`, the
 * same keys schoolQueries.ts/franchiseQueries.ts already use) so
 * SchoolLookupPage/FranchiseLookupPage immediately reflect the new
 * archivedAt/purgeAt state without a manual refresh. */
export function useCloseTenantAccount(kind: 'school' | 'franchise') {
  const queryClient = useQueryClient();
  const path = kind === 'school' ? '/v1/platform-admin/schools/{id}/close' : '/v1/platform-admin/franchises/{id}/close';
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CloseTenantAccountInput }) =>
      unwrap(apiClient.POST(path, { params: { path: { id } }, body })),
    onSuccess: (_data, { id }) => queryClient.invalidateQueries({ queryKey: [`platform-admin-${kind}`, id] }),
  });
}

export function useReactivateTenantAccount(kind: 'school' | 'franchise') {
  const queryClient = useQueryClient();
  const path = kind === 'school' ? '/v1/platform-admin/schools/{id}/reactivate' : '/v1/platform-admin/franchises/{id}/reactivate';
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST(path, { params: { path: { id } } })),
    onSuccess: (_data, id) => queryClient.invalidateQueries({ queryKey: [`platform-admin-${kind}`, id] }),
  });
}
