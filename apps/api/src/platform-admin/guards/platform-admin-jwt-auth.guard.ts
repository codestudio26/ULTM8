import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformAdminAuthService } from '../platform-admin-auth.service';

/**
 * Gates every Platform Admin endpoint. The named-strategy check ('platform-admin-jwt',
 * registered by PlatformAdminJwtStrategy) is the realm-isolation half — a tenant
 * token can never pass this at all, proven directly in platform-admin-auth.e2e-spec.ts.
 *
 * FOUND ON REVIEW (Phase 25, flagged then, resolved now that a real Slice 2+
 * endpoint exists to make the tradeoff concrete): PlatformAdminJwtStrategy's own
 * `validate()` only checks signature/expiry, same as the tenant realm's JwtStrategy
 * — a revoked AdminUser's still-unexpired token would otherwise be trusted for up
 * to PLATFORM_ADMIN_JWT_TTL regardless of which endpoint it's used against. Unlike
 * the tenant realm (where a short TTL is the accepted, spec-referenced staleness
 * window), this is the highest-privilege identity boundary in the system, so this
 * guard does the extra per-request check itself, reusing
 * PlatformAdminAuthService.findActiveById (already built in Slice 1 for `/me`) —
 * every endpoint behind this guard gets it automatically, not just the ones whose
 * own handler happens to re-fetch the AdminUser for an unrelated reason (`/me`
 * still does its own separate fetch too, for `name`, which isn't in the JWT — a
 * small, accepted duplication in exchange for this guard guaranteeing the
 * revocation check regardless of what any given handler needs).
 */
@Injectable()
export class PlatformAdminJwtAuthGuard extends AuthGuard('platform-admin-jwt') {
  constructor(private readonly platformAdminAuth: PlatformAdminAuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const passportOk = (await super.canActivate(context)) as boolean;
    if (!passportOk) return false;

    const request = context.switchToHttp().getRequest();
    // Throws UnauthorizedException if the AdminUser is missing/revoked — same
    // generic, non-distinguishing 401 posture as PlatformAdminAuthService's own
    // exchangeCognitoToken().
    await this.platformAdminAuth.findActiveById(request.user.sub);
    return true;
  }
}
