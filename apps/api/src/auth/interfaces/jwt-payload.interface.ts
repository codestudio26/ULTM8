/**
 * Access-token claims — built from the full set of currently-active RoleGrants at
 * login (ultm8-domain-rules §3: "Sessions/JWTs are built from the full set of
 * currently-active grants at login/refresh time, not an inferred or implicit role
 * column").
 */
export interface RoleGrantClaim {
  role: string;
  franchiseId: string | null;
  schoolId: string | null;
  branchId: string | null;
}

export interface JwtPayload {
  sub: string; // User.id
  email: string;
  grants: RoleGrantClaim[];
}
