import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';

/**
 * Fresh-DB authorization checks for TenantsModule's mutating endpoints.
 *
 * Deliberate split of responsibilities (mirrors the RLS design already established in
 * Phase 1's migration.sql): Row-Level Security answers "which School/Branch/RoleGrant
 * rows can this caller's connection see or write at all" (tenant-boundary enforcement —
 * ultm8-tenant-isolation §2) — but School/Branch's RLS policies deliberately admit ANY
 * active RoleGrant holder at a School (Student, Instructor, Branch Staff, School
 * Owner/Manager alike — see school_tenant_isolation/branch_tenant_isolation in
 * migration.sql), not just School Owner/Manager. That's correct for read visibility,
 * but wrong for the write endpoints this module adds, which the only confirmed rule
 * (Spec §8.2: "School Owner/Manager: Manage their own School/Branches") actually
 * restricts to School Owner/Manager alone. This service is that narrower, business-
 * level authorization layer, sitting on top of (not instead of) RLS.
 *
 * Queries the DB fresh on every call rather than trusting the JWT's embedded
 * RoleGrantClaim set, specifically so a revoked grant is respected immediately rather
 * than only once the caller's (up to 15-minute) access token expires and is reissued —
 * see the Phase 2 summary's note on RoleGrant-revocation-vs-token-staleness for the
 * general limitation this does NOT close (a stale token can still pass JwtAuthGuard and
 * read/attempt writes elsewhere; this check specifically closes it for the School-
 * Owner-gated actions in this module).
 */
@Injectable()
export class TenantAuthorizationService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  /**
   * Throws ForbiddenException unless `userId` currently holds an active
   * SCHOOL_OWNER_MANAGER RoleGrant scoped to `schoolId`.
   */
  async assertSchoolOwner(userId: string, schoolId: string): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId,
          schoolId,
          role: 'SCHOOL_OWNER_MANAGER',
          revokedAt: null,
        },
        select: { id: true },
      }),
    );
    if (!grant) {
      throw new ForbiddenException(
        'Only that School\'s Owner/Manager may perform this action (Spec §8.2).',
      );
    }
  }
}
