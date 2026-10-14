import { decodeJwtPayload } from './decodeJwt';
import type { JwtClaims } from './types';

// Proactive-refresh buffer (Track B roadmap's own flagged "Not yet" item, closed
// by AuthContext's on-launch path) — treats a token as needing refresh slightly
// BEFORE its real `exp`, not just after, so a request that happens to fire a
// second or two after this check doesn't itself race the token's own expiry.
// Small on purpose: apps/api's own JWT_ACCESS_TTL is 15 minutes, so this buffer
// only ever matters in the narrow window right at the boundary, not as a
// general "refresh early" policy.
export const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 30_000;

/** Decides whether AuthContext's on-launch path should proactively refresh
 * rather than apply the stored token as-is. A token with no readable `exp`
 * claim (should never happen for a token this app itself issued, but not
 * asserted away) is treated as needing refresh too — failing toward "try to
 * refresh" is safe (refreshSession() itself fails toward logout() if the
 * refresh token is also no good), unlike failing toward "trust an
 * unverifiable token." Pulled into its own file so this is unit-testable
 * without rendering AuthProvider. */
export function isAccessTokenExpiredOrNearExpiry(token: string): boolean {
  const claims = decodeJwtPayload<JwtClaims>(token);
  if (!claims?.exp) return true;
  return Date.now() >= claims.exp * 1000 - ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}
