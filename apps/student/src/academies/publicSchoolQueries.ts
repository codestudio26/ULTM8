import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { authClient } from '../api';

/**
 * Decision 266 — SchoolPickScreen's two modes (search, join code). Both use
 * `authClient`, not `apiClient` — same reasoning as AuthContext's own direct
 * login/refresh/logout calls (api.ts's own header comment): there is no
 * session yet at this point in the app, so there's nothing for
 * `apiClient`'s onUnauthorized retry middleware to meaningfully do here
 * either, even though these specific routes can never actually 401 (they're
 * unauthenticated by design, PublicAcademiesController).
 */
export function useSchoolSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['public-school-search', trimmed],
    queryFn: () => unwrap(authClient.GET('/v1/public/schools/search', { params: { query: { q: trimmed } } })),
    enabled: trimmed.length > 0,
  });
}

export function useSchoolByJoinCode(code: string | null) {
  return useQuery({
    queryKey: ['public-school-by-code', code],
    queryFn: () => unwrap(authClient.GET('/v1/public/schools/by-code/{code}', { params: { path: { code: code! } } })),
    enabled: !!code,
    retry: false, // a wrong code is a normal 404, not a transient failure worth retrying
  });
}
