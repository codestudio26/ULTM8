import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditLogService, AuditAction } from './audit-log.service';

/**
 * FOUND ON REVIEW (School/Franchise, Phase 26/27): a first draft calling
 * `findUnique` with no explicit `select` fails outright with a Postgres permission
 * error the moment it hits a column `ultm8_platform_admin` isn't granted — same
 * lesson applied here without repeating the mistake. Deliberately excludes
 * `stripeConnectedAccountId` — see this constant's own migration
 * (20260927000000_platform_admin_payment_account_read) and
 * PlatformAdminPaymentAccountResponseDto's own header comment for why.
 */
const PLATFORM_ADMIN_PAYMENT_ACCOUNT_SELECT = {
  id: true,
  schoolId: true,
  franchiseId: true,
  provider: true,
  accountTitle: true,
  country: true,
  status: true,
  mode: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * PlatformAdminModule Slice 6 (Phase 30) — the third cross-tenant read entity, and
 * the FIRST read in this module restricted to a specific subRole rather than opened
 * to all three tiers. Confirmed directly by ultm8-tenant-isolation SKILL.md §3:
 * "Billing/Payments Ops — can view PaymentAccount configuration status and
 * initiate a Stripe Connect credential rotation, but never sees a decrypted
 * secret." Support's own bullet explicitly lists "a Stripe Connected Account id"
 * among what it must never see, and nothing in that same section confirms Support
 * gets PaymentAccount-configuration visibility at all — so this read is
 * BILLING_PAYMENTS_OPS + FULL_ADMIN only, not guessed wider than the spec confirms.
 * FULL_ADMIN is included because every confirmed FULL_ADMIN capability in the spec
 * is a superset of the narrower tiers' own (the tier that "can assign sub-roles to
 * other staff" is never described as having LESS access than the tiers it assigns).
 *
 * Only the READ half of Billing/Payments Ops's confirmed capability is built here —
 * "initiate a Stripe Connect credential rotation" is a separate, undesigned write
 * path (how rotation actually works against Stripe Connect/secrets-manager custody
 * is a real question PlatformAdminModule's own header comment already flags as not
 * guessed at), not built in this slice.
 */
@Injectable()
export class PlatformAdminPaymentAccountsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertBillingOrFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (
      !caller ||
      caller.revokedAt ||
      (caller.subRole !== AdminSubRole.BILLING_PAYMENTS_OPS && caller.subRole !== AdminSubRole.FULL_ADMIN)
    ) {
      throw new ForbiddenException('Only Billing/Payments Ops or a Full Platform Admin may view PaymentAccount configuration.');
    }
  }

  async findForSchool(callerId: string, schoolId: string) {
    await this.assertBillingOrFullAdmin(callerId);

    const account = await this.prismaPlatformAdmin.paymentAccount.findUnique({
      where: { schoolId },
      select: PLATFORM_ADMIN_PAYMENT_ACCOUNT_SELECT,
    });
    if (!account) {
      // Same "a failed/nonexistent lookup isn't itself audit-logged, only a
      // successful view is" convention PlatformAdminSchoolsService.findOne()
      // already established — see that method's own comment for the full
      // reasoning (including the still-open ID-probing question).
      throw new NotFoundException('PaymentAccount not found');
    }

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.VIEW_PAYMENT_ACCOUNT,
      targetType: 'PaymentAccount',
      targetId: account.id,
      schoolId: account.schoolId,
      franchiseId: account.franchiseId,
    });

    return account;
  }

  async findForFranchise(callerId: string, franchiseId: string) {
    await this.assertBillingOrFullAdmin(callerId);

    const account = await this.prismaPlatformAdmin.paymentAccount.findUnique({
      where: { franchiseId },
      select: PLATFORM_ADMIN_PAYMENT_ACCOUNT_SELECT,
    });
    if (!account) {
      throw new NotFoundException('PaymentAccount not found');
    }

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.VIEW_PAYMENT_ACCOUNT,
      targetType: 'PaymentAccount',
      targetId: account.id,
      schoolId: account.schoolId,
      franchiseId: account.franchiseId,
    });

    return account;
  }
}
