/**
 * Previously a hand-copy of apps/api/src/auth/interfaces/jwt-payload.interface.ts,
 * duplicated once per frontend app. Now the single canonical definition lives in
 * @ultm8/auth — `import type` is erased entirely at compile time (zero runtime
 * import), so this re-export carries none of the `atob`/`decodeJwtPayload` runtime
 * risk this app originally avoided the package for; see @ultm8/auth's own comment on
 * these two interfaces for the full reasoning.
 */
export type { JwtClaims, RoleGrantClaim } from '@ultm8/auth';
