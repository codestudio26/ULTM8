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

/** The slug of the privacy notice a Guardian's consent refers to (Decision 171). */
export const PRIVACY_NOTICE_SLUG = 'privacy-statement';

/** GET /legal/privacy-statement — the current privacy notice text and version
 * (Decision 171). `currentVersion` is null until a Platform Admin publishes it,
 * and consent cannot be given until then. */
export function usePrivacyNotice() {
  return useQuery({
    queryKey: ['legal-document', PRIVACY_NOTICE_SLUG],
    queryFn: () => unwrap(apiClient.GET('/v1/legal/{doc}', { params: { path: { doc: PRIVACY_NOTICE_SLUG } } })),
  });
}

/** What a consent records as its policyVersion: `privacy-statement@<n>`. */
export function policyVersionOf(currentVersion: number) {
  return `${PRIVACY_NOTICE_SLUG}@${currentVersion}`;
}

/** POST /guardians/me/minors/{studentId}/consent — upserts server-side, so
 * re-granting after a withdrawal reactivates the same record rather than
 * erroring (GuardiansService.grantConsent's own header comment). The server
 * refuses it unless a School has confirmed the link (Decision 172), the
 * policyVersion is the current notice (Decision 171), and the Guardian has
 * declared parental responsibility (Decision 172). */
export function useGrantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, tier, policyVersion }: { studentId: string; tier: 'BASELINE' | 'CAMERA'; policyVersion: string }) =>
      unwrap(
        apiClient.POST('/v1/guardians/me/minors/{studentId}/consent', {
          params: { path: { studentId } },
          body: { tier, policyVersion, parentalResponsibilityDeclared: true },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-consent-records'] });
      queryClient.invalidateQueries({ queryKey: ['my-consent-events'] });
    },
  });
}

/** GET /guardians/me/consent-events — the Guardian's own append-only consent
 * history, newest first (Decision 170). */
export function useMyConsentEvents() {
  return useQuery({
    queryKey: ['my-consent-events'],
    queryFn: () => unwrap(apiClient.GET('/v1/guardians/me/consent-events', {})),
  });
}

/** PATCH /guardians/me/consent/{id}/withdraw — proportional to tier
 * (GuardiansService.withdrawConsent's own header comment, quoting SKILL.md
 * §14): BASELINE, once no other Guardian still consents, revokes the minor's
 * enrolments and erases their data (Decision 173); CAMERA-only clears the
 * stored profile photo and blocks future self-service QR check-in. The UI must make this consequence explicit before
 * calling this, not just say "withdraw." */
export function useWithdrawConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (consentRecordId: string) =>
      unwrap(apiClient.PATCH('/v1/guardians/me/consent/{id}/withdraw', { params: { path: { id: consentRecordId } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-consent-records'] });
      queryClient.invalidateQueries({ queryKey: ['my-consent-events'] });
      // A last baseline withdrawal erases the minor, and one made while another
      // Guardian still consents revokes this Guardian's link (Decision 173).
      queryClient.invalidateQueries({ queryKey: ['my-minors'] });
    },
  });
}
