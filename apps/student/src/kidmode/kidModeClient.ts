import { createApiClient, unwrap } from '@ultm8/api-client';
import { baseUrl } from '../api';

/**
 * Decision 123 — a dedicated, one-off client bound to a fixed Kid-Mode token,
 * never the shared `apiClient`/`tokenCache` singleton (api.ts). Deliberate
 * isolation: the main app's token cache always reflects the CURRENT Guardian
 * session, and nothing about entering or leaving Kid Mode should be able to
 * disturb it — if this used the shared cache (even "temporarily swapped back
 * after"), an error mid-flow could leave the main session pointed at a narrow,
 * short-lived Kid-Mode token by accident. Backend enforcement (JwtStrategy +
 * BookingsController's live BookingDelegation re-check) is what actually makes
 * this safe even if misused; this client-side isolation is extra, cheap
 * insurance, not the security boundary itself.
 */
function createKidModeClient(token: string) {
  return createApiClient({ baseUrl, getAccessToken: () => token });
}

/** The ONE call a Kid-Mode token may make — see JwtStrategy's own
 * KID_MODE_ALLOWED_PATH comment. `studentId` must match the token's own
 * `kidMode.studentId` claim exactly (enforced server-side); the caller here is
 * always the one minor KidModeBookingScreen already minted this token for. */
export function bookClassAsKidMode(token: string, classId: string, studentId: string) {
  const client = createKidModeClient(token);
  return unwrap(client.POST('/v1/classes/{id}/book', { params: { path: { id: classId } }, body: { studentId } }));
}
