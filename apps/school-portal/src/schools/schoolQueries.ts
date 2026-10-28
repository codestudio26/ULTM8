import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SchoolResponse = components['schemas']['SchoolResponseDto'];
export type CreateSchoolInput = components['schemas']['CreateSchoolDto'];
export type UpdateSchoolInput = components['schemas']['UpdateSchoolDto'];

export function useSchool(schoolId: string | null) {
  return useQuery({
    queryKey: ['school', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** One query per School via `useQueries` — same fan-out pattern
 * `useSchoolSkillGroups` already established for a dynamic-length id list
 * (curriculumQueries.ts), here for `SchoolSwitcher`'s option labels. Returns
 * `null` for a name still loading or that failed to load, rather than
 * blocking the whole switcher on every School resolving. */
export function useSchoolNames(schoolIds: string[]): Array<{ id: string; name: string | null }> {
  const results = useQueries({
    queries: schoolIds.map((id) => ({
      queryKey: ['school', id],
      queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}', { params: { path: { id } } })),
    })),
  });
  return schoolIds.map((id, i) => ({ id, name: results[i]?.data?.name ?? null }));
}

export function useCreateSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSchoolInput) => unwrap(apiClient.POST('/v1/schools', { body })),
    onSuccess: () => {
      // The new grant only takes effect on this token at next login (Spec §8.3 — JWTs
      // are only rebuilt from the live RoleGrant set at login/refresh time), so the
      // caller re-logs in after creating their first School; this just invalidates any
      // cached school queries for when they do.
      queryClient.invalidateQueries({ queryKey: ['school'] });
    },
  });
}

export function useUpdateSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSchoolInput) =>
      unwrap(apiClient.PATCH('/v1/schools/{id}', { params: { path: { id: schoolId } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school', schoolId] });
    },
  });
}

/** Decision 350 — the Franchise's name and logo, set only when both the
 * Franchise Owner and the School Owner allow it. Keyed under ['school', id] so
 * saving the School, joining or leaving refreshes it too. */
export function useSchoolFranchiseBranding(schoolId: string | null) {
  return useQuery({
    queryKey: ['school', schoolId, 'franchise-branding'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}/franchise-branding', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Decision 352 — asks to join: the Franchise Owner accepts or declines (409
 * if already affiliated or already asking). "Switch" is leave, then ask again. */
export function useJoinFranchise(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (franchiseId: string) =>
      unwrap(apiClient.POST('/v1/schools/{id}/join-franchise', { params: { path: { id: schoolId } }, body: { franchiseId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  });
}

/** Decision 232 — leave the current Franchise (PaymentAccount/MembershipPlan
 * untouched; the old Stripe subscription is cancelled best-effort server-side). */
export function useLeaveFranchise(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{id}/leave-franchise', { params: { path: { id: schoolId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  });
}

/** Decision 352 — this School's latest request to join a Franchise (pending,
 * accepted, declined or cancelled), or null if it never asked. */
export function useSchoolFranchiseJoinRequest(schoolId: string | null) {
  return useQuery({
    queryKey: ['school', schoolId, 'franchise-join-request'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}/franchise-join-request', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Decision 352 — withdraws the School's pending request to join. */
export function useCancelFranchiseJoinRequest(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{id}/franchise-join-request/cancel', { params: { path: { id: schoolId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  });
}

/** Decision 364 — the School Owner closes their own School: re-checks the
 * passcode first (POST /auth/step-up/verify), then closes with that proof. */
export function useCloseSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ confirmName, passcode }: { confirmName: string; passcode: string }) => {
      const { stepUpToken } = await unwrap(apiClient.POST('/v1/auth/step-up/verify', { body: { passcode } }));
      return unwrap(
        apiClient.POST('/v1/schools/{id}/close', {
          params: { path: { id: schoolId }, header: { 'x-step-up-token': stepUpToken } },
          body: { confirmName },
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  });
}

/** Decision 266/367 — a new join code; the old one stops working at once. */
export function useRegenerateJoinCode(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{id}/join-code/regenerate', { params: { path: { id: schoolId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  });
}

/** Decision 368 (Q4) — the Franchise's name, to confirm before asking to join. */
export function useFranchisePreview(schoolId: string) {
  return useMutation({
    mutationFn: (franchiseId: string) =>
      unwrap(apiClient.GET('/v1/schools/{id}/franchise-preview', { params: { path: { id: schoolId }, query: { franchiseId } } })),
  });
}
