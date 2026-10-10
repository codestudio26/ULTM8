import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type AdminUserResponse = components['schemas']['AdminUserResponseDto'];
export type CreateAdminUserInput = components['schemas']['CreateAdminUserDto'];

/** Every AdminUser — FULL_ADMIN-only server-side (assertFullAdmin, see
 * PlatformAdminUsersService's own header comment); a SUPPORT/BILLING_PAYMENTS_OPS
 * caller gets a 403 from apps/api regardless of what this screen renders. No
 * pagination — same bounded-administrative-view convention every other list
 * screen in this monorepo already uses (useFranchises, useBranches, etc.), and
 * the Platform Admin roster is small by nature. */
export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/admin-users', {})),
  });
}

export function useCreateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminUserInput) => unwrap(apiClient.POST('/v1/platform-admin/admin-users', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}

/** Soft-revoke (sets revokedAt) — idempotent server-side, and the server itself
 * refuses to revoke the last active FULL_ADMIN (409) rather than this screen
 * trying to predict that client-side; see PlatformAdminUsersService.revoke()'s
 * own header comment for why that check can't be done safely from here anyway
 * (a global count across the whole roster, race-prone without the server's own
 * advisory lock). */
export function useRevokeAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.DELETE('/v1/platform-admin/admin-users/{id}', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });
}
