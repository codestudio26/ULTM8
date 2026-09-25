/**
 * Mirrors apps/api/src/auth/interfaces/jwt-payload.interface.ts exactly, same as
 * apps/school-portal/src/auth/types.ts — not exported from a shared package because the
 * JWT payload is never a request/response body of any endpoint (only login's
 * `{accessToken}` string is), so there's nothing for the OpenAPI generator to produce
 * it from. Re-verify against that file if AuthService.login() ever changes what it
 * signs into the token.
 */
export interface RoleGrantClaim {
  role: string;
  franchiseId: string | null;
  schoolId: string | null;
  branchId: string | null;
}

export interface JwtClaims {
  sub: string; // User.id
  email: string;
  grants: RoleGrantClaim[];
  iat?: number;
  exp?: number;
}
