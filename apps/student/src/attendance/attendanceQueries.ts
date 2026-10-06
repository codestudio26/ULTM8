import { useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type QrTokenResponse = components['schemas']['QrTokenResponseDto'];

/** Backs QrCheckInScreen — the Student's own rotating check-in code (Phase 51,
 * Decision 107's `GET /attendance/my-qr-token`): class-agnostic, identifies
 * only the Student; an Instructor's scan matches it against whichever Class
 * they're currently taking roll-call for. Same refresh-just-before-expiry
 * cadence apps/school-portal's `useClassQrToken` already established for the
 * sibling endpoint — kept in sync with that same reasoning, not re-derived:
 * `QR_ATTENDANCE_TOKEN_TTL_SECONDS` is an explicit Developer-level placeholder
 * on the backend (QrTokenService's own header comment), so hardcoding an
 * assumed TTL here would silently drift if that value ever changes. */
export function useMyQrToken(enabled: boolean) {
  return useQuery({
    queryKey: ['myQrToken'],
    queryFn: () => unwrap(apiClient.GET('/v1/attendance/my-qr-token', {})),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as QrTokenResponse | undefined;
      if (!data) return 5_000;
      const msUntilExpiry = new Date(data.expiresAt).getTime() - Date.now();
      return Math.max(1_000, msUntilExpiry - 2_000);
    },
    // A stale token is worthless the moment it expires — never serve a cached
    // one on remount instead of fetching fresh, same reasoning
    // useClassQrToken already established for the sibling endpoint.
    staleTime: 0,
  });
}
