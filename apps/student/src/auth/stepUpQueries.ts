import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** POST /auth/step-up/verify (Decision 236) — re-checks the caller's own
 * passcode and, on success, returns a short-lived proof to send as the
 * `X-Step-Up-Token` header on the one sensitive request it gates. Not
 * cached/invalidated against anything — this mints a fresh, single-purpose
 * token each time, never a cached read. */
export function useVerifyStepUp() {
  return useMutation({
    mutationFn: (passcode: string) => unwrap(apiClient.POST('/v1/auth/step-up/verify', { body: { passcode } })),
  });
}
