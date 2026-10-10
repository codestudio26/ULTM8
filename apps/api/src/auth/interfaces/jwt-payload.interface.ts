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
  /** Phase 47 — the one School this session is scoped to (Spec 55 §12.1
   * Decision 39). JwtStrategy.validate() reads this to populate
   * RequestContext, which PrismaAppService.withTenantContext consumes to set
   * app.impersonation_school_id — see that migration's own header comment
   * (20261002000000_impersonation_scope_rls_fix) for the full mechanism. */
  schoolId: string;
}

/**
 * Decision 123 — Guardian "Kid Mode" booking delegation. Present ONLY on a token
 * GuardiansService.mintKidModeToken() signs; absent on every ordinary tenant
 * login/register/refresh token, including the Guardian's own normal one. `sub`
 * above is still the Guardian's own id (this is never a separate minor
 * identity/login — see BookingDelegation's own model comment) — `studentId`
 * here is the ONE linked minor this token may book for, fixed at mint time from
 * a live BookingDelegation check, never widened after issuance. Same
 * "JwtStrategy.validate() is the one central choke point" reasoning
 * ImpersonationClaim already established: a Kid-Mode token making any request
 * other than the single-Class booking-create endpoint, or naming a different
 * studentId than this claim's own, is rejected before it ever reaches a
 * controller.
 */
export interface KidModeClaim {
  studentId: string; // User.id of the one linked minor this token may book for
}

export interface JwtPayload {
  sub: string; // User.id
  email: string;
  grants: RoleGrantClaim[];
  impersonation?: ImpersonationClaim;
  kidMode?: KidModeClaim;
}
