import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StartImpersonationSessionInput = components['schemas']['StartImpersonationSessionDto'];
export type ImpersonationSessionResponse = components['schemas']['ImpersonationSessionResponseDto'];

/** POST /platform-admin/impersonation-sessions (Phase 43/46/47, Decision 102 +
 * Spec 55 Decision 39) — the one write PlatformAdminModule exposes that hands
 * back a genuine TENANT-realm JWT rather than acting itself; see
 * ImpersonationSessionResponseDto's own header comment. SUPPORT/FULL_ADMIN-only
 * server-side (assertSupportOrFullAdmin) — a caller outside those tiers gets
 * this screen's own error state (403), same "backend is the real authorization
 * boundary" convention every other write in this app already follows. No
 * client-side pre-validation of userId/schoolId beyond `required` — the server's
 * own 404 (unknown User) or whatever RLS/lookup error results surfaces directly,
 * same convention useRotateCredential's own comment establishes for not
 * predicting a server-side rule client-side. Not invalidating any query on
 * success — this mutation doesn't change any tenant-admin-visible record, only
 * mints a token, so there's nothing here for the rest of this app to refetch. */
export function useStartImpersonationSession() {
  return useMutation({
    mutationFn: (body: StartImpersonationSessionInput) =>
      unwrap(apiClient.POST('/v1/platform-admin/impersonation-sessions', { body })),
  });
}
