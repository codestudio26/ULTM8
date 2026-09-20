import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type QrTokenResponse = components['schemas']['QrTokenResponseDto'];

/** Backs ClassQrCodePage — the School Portal's own rotating-QR display screen
 * (Phase 52, following Phase 51/Decision 107's `GET /classes/{id}/qr-token`).
 * Re-mints a fresh token shortly before the current one expires rather than on
 * a fixed interval: `QR_ATTENDANCE_TOKEN_TTL_SECONDS` is an explicit
 * Developer-level placeholder on the backend (QrTokenService's own header
 * comment), so hardcoding an assumed TTL here would silently drift out of sync
 * if that value ever changes. The 2-second safety margin absorbs normal
 * request latency so the displayed code is never shown already-expired. */
export function useClassQrToken(classId: string | null) {
  return useQuery({
    queryKey: ['classQrToken', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}/qr-token', { params: { path: { id: classId! } } })),
    enabled: !!classId,
    refetchInterval: (query) => {
      const data = query.state.data as QrTokenResponse | undefined;
      if (!data) return 5_000;
      const msUntilExpiry = new Date(data.expiresAt).getTime() - Date.now();
      return Math.max(1_000, msUntilExpiry - 2_000);
    },
    // A stale token is worthless the moment it expires — never serve a cached
    // one on remount instead of fetching fresh.
    staleTime: 0,
  });
}
