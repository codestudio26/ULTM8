/**
 * Mirrors apps/api/src/auth/interfaces/jwt-payload.interface.ts exactly — not exported
 * from a shared package because the JWT payload is never a request/response body of
 * any endpoint (it's not part of the OpenAPI spec, only login's `{accessToken}` string
 * is), so there's nothing for the generator to produce it from. Duplicated here
 * deliberately, cited back to its source so a future change there is easy to catch —
 * re-verify against that file if apps/api's AuthService.login() ever changes what it
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
