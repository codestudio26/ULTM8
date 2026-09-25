import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** GET /guardians/me/minors — not paginated (MinorListResponseDto has no
 * nextCursor, matching StudentRankListResponseDto's own precedent for a
 * genuinely small, unpaginated list). */
export function useMyMinors() {
  return useQuery({
    queryKey: ['my-minors'],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/minors', {})),
  });
}

/** GET /guardians/me/consent — every ConsentRecord this Guardian has ever
 * granted, across all linked minors and both tiers. Not paginated
 * (ConsentRecordListResponseDto has no nextCursor). */
export function useMyConsentRecords() {
  return useQuery({
    queryKey: ['my-consent-records'],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/consent', {})),
  });
}

/** POST /guardians/me/minors — CreateMinorDto's own confirmed field list:
 * firstName/surname/dateOfBirth required, gender optional. No rank field —
 * that's populated later by Staff grading, not supplied at creation. */
export function useAddMinor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { firstName: string; surname: string; dateOfBirth: string; gender?: string }) =>
      unwrap(apiClient.POST('/v1/guardians/me/minors', { body: dto })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-minors'] }),
  });
}

/** POST /guardians/me/minors/{studentId}/consent — upserts server-side, so
 * re-granting after a withdrawal reactivates the same record rather than
 * erroring (GuardiansService.grantConsent's own header comment). */
export function useGrantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, tier, policyVersion }: { studentId: string; tier: 'BASELINE' | 'CAMERA'; policyVersion: string }) =>
      unwrap(
        apiClient.POST('/v1/guardians/me/minors/{studentId}/consent', {
          params: { path: { studentId } },
          body: { tier, policyVersion },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-consent-records'] }),
  });
}

/** PATCH /guardians/me/consent/{id}/withdraw — proportional to tier
 * (GuardiansService.withdrawConsent's own header comment, quoting SKILL.md
 * §14): BASELINE triggers the full RoleGrant-revocation cascade for that one
 * Student; CAMERA-only clears the stored profile photo and blocks future
 * self-service QR check-in. The UI must make this consequence explicit before
 * calling this, not just say "withdraw." */
export function useWithdrawConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (consentRecordId: string) =>
      unwrap(apiClient.PATCH('/v1/guardians/me/consent/{id}/withdraw', { params: { path: { id: consentRecordId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-consent-records'] }),
  });
}
