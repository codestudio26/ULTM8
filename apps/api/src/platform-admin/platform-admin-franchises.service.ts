import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditLogService, AuditAction } from './audit-log.service';

/** Same "explicit select matching the column-level GRANT exactly" requirement
 * PlatformAdminSchoolsService's own PLATFORM_ADMIN_SCHOOL_SELECT documents —
 * see that constant's header comment for the full account of why (a bare
 * `findUnique` with no `select` would fail with a Postgres permission error the
 * moment it ran, since ultm8_platform_admin is deliberately not granted
 * stripeMeterId/stripeUsagePriceId). Matches FRANCHISE_PUBLIC_SELECT
 * (franchises.service.ts) and FranchiseResponseDto field-for-field. */
const PLATFORM_ADMIN_FRANCHISE_SELECT = {
  id: true,
  name: true,
  mobileNumber: true,
  address: true,
  type: true,
  activities: true,
  facilities: true,
  defaultLanguage: true,
  defaultCurrency: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  feeModel: true,
  flatFeeAmount: true,
  perHeadcountRate: true,
  createdAt: true,
  updatedAt: true,
  // Phase 56 (Decision 110) — lifecycle state, same addition as the School twin
  // of this constant (platform-admin-schools.service.ts).
  archivedAt: true,
  purgeAt: true,
  purgedAt: true,
  // Deliberately excluded: stripeMeterId, stripeUsagePriceId — see this
  // constant's own header comment.
} as const;

/** PlatformAdminModule's second cross-tenant admin read — Slice 3 (Phase 27),
 * mirroring PlatformAdminSchoolsService exactly (same reasoning for why this is
 * read-only, why there's no AdminSubRole restriction, and why a failed lookup
 * isn't itself audit-logged — see that service's own header/inline comments,
 * not repeated here). */
@Injectable()
export class PlatformAdminFranchisesService {
  constructor(
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findOne(adminUserId: string, franchiseId: string) {
    const franchise = await this.prismaPlatformAdmin.franchise.findUnique({
      where: { id: franchiseId },
      select: PLATFORM_ADMIN_FRANCHISE_SELECT,
    });
    if (!franchise) {
      throw new NotFoundException('Franchise not found');
    }

    await this.auditLog.record({
      adminUserId,
      action: AuditAction.VIEW_FRANCHISE,
      targetType: 'Franchise',
      targetId: franchise.id,
      franchiseId: franchise.id,
    });

    return franchise;
  }
}
