/**
 * Previously a hand-copy of apps/api/src/auth/interfaces/jwt-payload.interface.ts,
 * duplicated once per frontend app. Now the single canonical definition lives in
 * @ultm8/auth, which this app already depends on at runtime (sessionStorageTokenStore/
 * decodeJwtPayload) — a plain re-export here.
 */
export type { JwtClaims, RoleGrantClaim } from '@ultm8/auth';
