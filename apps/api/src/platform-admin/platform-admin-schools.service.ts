import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditLogService, AuditAction } from './audit-log.service';

/**
 * FOUND ON REVIEW, before this ever shipped: a first draft called
 * `prisma.school.findUnique({ where: { id } })` with no explicit `select` — Prisma's
 * default without one is to request every scalar column (`SELECT *`-equivalent at
 * the generated SQL level), which would have failed outright with a Postgres
 * permission error the moment it ran, since `ultm8_platform_admin` is deliberately
 * NOT granted `stripeFranchiseFeeSubscriptionId` (see this phase's own migration).
 * Same lesson `FRANCHISE_PUBLIC_SELECT` already recorded elsewhere in this codebase:
 * Prisma's own `omit` API isn't enabled here, so an explicit, named `select` object
 * matching the actual column-level GRANT exactly is required, not optional — this
 * constant is that.
 */
const PLATFORM_ADMIN_SCHOOL_SELECT = {
  id: true,
  franchiseId: true,
  name: true,
  mobileNumber: true,
  address: true,
  businessType: true,
  activities: true,
  facilities: true,
  ranksToggle: true,
  defaultLanguage: true,
  defaultCurrency: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  classCancellationPolicy: true,
  waitlistClaimWindowMinutes: true,
  franchiseFeeSubscriptionStatus: true,
  createdAt: true,
  updatedAt: true,
  // Phase 56 (Decision 110) — lifecycle state, granted to ultm8_platform_admin
  // by 20261006000000_tenant_lifecycle_module. Support-tier staff should be
  // able to see a School is closed from the same read they already use.
  archivedAt: true,
  purgeAt: true,
  purgedAt: true,
  // Deliberately excluded: stripeFranchiseFeeSubscriptionId — see this constant's
  // own header comment.
} as const;

/**
 * PlatformAdminModule's first real cross-tenant admin business-logic endpoint —
 * Slice 2 (Phase 26). Read-only, on purpose: the confirmed audit-logged actions
 * (ultm8-tenant-isolation SKILL.md §6) are "viewing/editing another tenant's
 * records, viewing/rotating a payment credential, impersonating a tenant user" —
 * viewing is the least-consequential of those, and the natural starting point now
 * that the audit-log mechanism this whole category of endpoint requires actually
 * exists. Writes/credential-rotation/impersonation are each their own real,
 * separate slice — not built here.
 *
 * No AdminSubRole restriction on this specific read — SUPPORT/BILLING_PAYMENTS_OPS/
 * FULL_ADMIN can all reach it. The one subRole restriction the spec actually states
 * is narrower and different: "only Full Platform Admin can assign sub-roles to
 * other staff" (ultm8-tenant-isolation SKILL.md §3) — nothing suggests routine
 * support-facing reads like this one are FULL_ADMIN-only, and restricting it that
 * way would make the SUPPORT tier unable to do the routine support work its own
 * name implies. Revisit if a future decision says otherwise; not guessed at beyond
 * this reasoning.
 */
@Injectable()
export class PlatformAdminSchoolsService {
  constructor(
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findOne(adminUserId: string, schoolId: string) {
    const school = await this.prismaPlatformAdmin.school.findUnique({
      where: { id: schoolId },
      select: PLATFORM_ADMIN_SCHOOL_SELECT,
    });
    if (!school) {
      // FOUND ON REVIEW, flagged rather than silently decided: a failed lookup
      // (a School id that doesn't exist, or a probing attempt) is NOT itself
      // audit-logged — only a successful view is, matching the confirmed action
      // category's own literal wording ("viewing... a record" — there is no
      // record to view here). Whether Platform Admin ID-probing/enumeration
      // attempts should ALSO be logged for security-monitoring purposes is a
      // genuinely separate question the spec doesn't confirm either way — not
      // decided here, flagged for an explicit product/security-owner call if
      // this ever becomes a real concern.
      throw new NotFoundException('School not found');
    }

    // Recorded even though this is a read — "viewing another tenant's records" is
    // explicitly one of the confirmed audit-logged action categories, not just the
    // write ones. See AuditLogService's own header comment for why this isn't
    // wrapped in a try/catch: a Platform Admin view nobody can prove happened is
    // worse than a temporarily-unavailable one.
    await this.auditLog.record({
      adminUserId,
      action: AuditAction.VIEW_SCHOOL,
      targetType: 'School',
      targetId: school.id,
      schoolId: school.id,
      franchiseId: school.franchiseId,
    });

    return school;
  }
}
