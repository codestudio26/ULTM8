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

/**
 * Phase 43 (Decision 102 — PlatformAdminModule Support-tier impersonation is
 * read-only, resolved directly with the user, docs/decisions/POST-SPEC-55-
 * DECISION-LOG.md). Present ONLY on a token AuthService.issueImpersonationToken()
 * mints for a Platform-Admin-initiated session — absent on every ordinary tenant
 * login/register/refresh token. `adminUserId` is the Support (or Full Platform
 * Admin) staffer running the session, not the impersonated `sub` above; kept here
 * rather than only in the audit log so JwtStrategy.validate() can enforce
 * read-only without a second lookup on every request.
 */
export interface ImpersonationClaim {
  adminUserId: string; // AdminUser.id
  startedAt: string; // ISO datetime
}

export interface JwtPayload {
  sub: string; // User.id
  email: string;
  grants: RoleGrantClaim[];
  impersonation?: ImpersonationClaim;
}
