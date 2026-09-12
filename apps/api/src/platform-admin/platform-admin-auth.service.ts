import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { CognitoTokenVerifierService } from './cognito-token-verifier.service';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';

/**
 * Slice 1 of PlatformAdminModule — the auth spine only (verify a Cognito ID token,
 * map it to an AdminUser, issue ULTM8's own Platform Admin JWT). No actual admin
 * business-logic endpoints (cross-tenant reads, PaymentAccount management, audit-log
 * viewing) exist yet — deliberately out of scope for this slice, same "small,
 * reviewable slice" discipline every school-portal phase this session already
 * followed, not an oversight.
 *
 * AdminUser queries go through the bare PrismaAppService client directly, NOT
 * `withTenantContext` — this table deliberately has no RLS policy at all (see
 * prisma/migrations/20260902000000_init/migration.sql's own comment on the
 * "AdminUser has no RLS policy... access to it is gated entirely at the application
 * layer" decision made in Phase 1, before this module existed). Wrapping this in
 * `withTenantContext` would be actively wrong here, not just unnecessary — there is
 * no tenant User.id to set `app.current_user_id` to for a Platform Admin caller (they
 * are never a row in the `User` table at all), and AdminUser has no policy reading
 * that setting regardless.
 *
 * No self-service account creation here — Platform Admin accounts are provisioned
 * out-of-band (a FULL_ADMIN-run process; a one-time bootstrap script for the very
 * first FULL_ADMIN — see scripts/bootstrap-admin-user.ts), per ultm8-tenant-isolation
 * SKILL.md §3's "Full Platform Admin — the only tier that can assign sub-roles to
 * other staff." An inviting/self-service-management endpoint is a real, separate
 * later slice, not built here.
 */
@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly cognitoVerifier: CognitoTokenVerifierService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * §4.4's "SSO against the company's own identity provider plus mandatory 2FA" is
   * enforced entirely upstream, at Cognito's own User Pool configuration (MFA set to
   * Required) — this method has nothing to check about MFA itself, only whether the
   * token Cognito issued corresponds to a currently-active AdminUser. A caller who
   * authenticates against Cognito but isn't a provisioned AdminUser (any other
   * Workspace/Cognito-pool account) gets rejected here, not upstream — domain
   * restriction at the IdP is defense-in-depth, not the actual access-control
   * boundary (see PlatformAdminModule's own header comment).
   */
  async exchangeCognitoToken(idToken: string): Promise<string> {
    // FOUND ON REVIEW (CI, not a manual review pass — a real 500 the e2e suite's own
    // "verification itself fails" test caught): CognitoTokenVerifierService's own
    // header comment claims a verification failure "surface[s] as a generic 401
    // rather than distinguishing failure reasons back to the caller" — but nothing
    // here actually implemented that. `aws-jwt-verify` throws a plain Error (not an
    // HttpException) on bad signature/expiry/wrong-pool, which NestJS's default
    // handling maps to 500, not 401. Caught here and converted explicitly.
    // `ServiceUnavailableException` (CognitoTokenVerifierService's own "not
    // configured" case) is deliberately passed through unchanged, not swallowed into
    // 401 — that's a real ops/config problem, not "this token is invalid," and
    // should stay distinguishable in logs/monitoring.
    let sub: string;
    try {
      ({ sub } = await this.cognitoVerifier.verify(idToken));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new UnauthorizedException('Could not verify the provided token.');
    }

    const admin = await this.prismaApp.adminUser.findUnique({
      where: { ssoSubject: sub },
    });
    // Same "don't leak which part failed" posture as customer login — no distinction
    // between "no such AdminUser" and "AdminUser exists but is revoked" in the
    // response, both are a plain 401.
    if (!admin || admin.revokedAt) {
      throw new UnauthorizedException('Not recognized as an active Platform Admin.');
    }

    const payload: AdminJwtPayload = { sub: admin.id, email: admin.email, subRole: admin.subRole };
    return this.jwt.sign(payload);
  }

  async findActiveById(id: string) {
    const admin = await this.prismaApp.adminUser.findUnique({ where: { id } });
    if (!admin || admin.revokedAt) {
      throw new UnauthorizedException('Not recognized as an active Platform Admin.');
    }
    return admin;
  }
}
