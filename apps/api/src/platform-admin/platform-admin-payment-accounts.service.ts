import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditLogService, AuditAction } from './audit-log.service';
import { StripeClientService } from '../payments/stripe-client.service';

/** Used only by initiateCredentialRotation() below — deliberately a SEPARATE,
 * narrower constant from PLATFORM_ADMIN_PAYMENT_ACCOUNT_SELECT, not a superset
 * reused across both methods, so it's structurally obvious at each call site
 * which one is safe to return from an HTTP handler (this one is NOT —
 * stripeConnectedAccountId never leaves initiateCredentialRotation() itself; see
 * that method's own comment). */
const PLATFORM_ADMIN_PAYMENT_ACCOUNT_ROTATION_SELECT = {
  id: true,
  schoolId: true,
  franchiseId: true,
  provider: true,
  stripeConnectedAccountId: true,
} as const;

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
 * initiateCredentialRotation() (Phase 35) is the WRITE half — see that method's
 * own header comment for how "rotation" was resolved without guessing.
 */
@Injectable()
export class PlatformAdminPaymentAccountsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
    private readonly stripeClient: StripeClientService,
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

  /**
   * Billing/Payments Ops's own confirmed write capability (Spec 55 §3.2/§4.4/§8.2):
   * "the engineer initiates a new Stripe Connect onboarding/rotation flow (Section
   * 10.4)." Resolved without guessing by connecting two already-confirmed pieces
   * rather than inventing a new mechanism: the spec's own literal wording above,
   * and PaymentsService.initiateConnectOnboarding()'s own comment, which already
   * documents that re-requesting a fresh Stripe Account Link against an EXISTING
   * Connected Account (not revoking/replacing it) is "the normal, supported flow"
   * for exactly this case — Account Links are short-lived/single-use by Stripe's
   * own design, and an Express Connected Account (Decision 86) holds no other
   * platform-side "credential" to rotate in the first place. This method
   * deliberately mirrors that existing method's own accountLinks.create() call
   * rather than diverging from it.
   *
   * Deliberately narrower than initiateConnectOnboarding(): requires an EXISTING
   * stripeConnectedAccountId (rejects otherwise) rather than also handling the
   * "no Connected Account yet" branch that method does — creating a brand-new
   * Connected Account on a tenant's behalf, with no tenant-side action, is a
   * bigger, more consequential capability than "rotation" as the spec states it,
   * and isn't guessed at here. STRIPE-provider only, mirroring that same method's
   * own provider check — a CASH/BANK_TRANSFER PaymentAccount has no Stripe-side
   * credential of any kind to rotate.
   *
   * `stripeConnectedAccountId` is read via prismaPlatformAdmin (this phase's own
   * migration grants that one column, additively, for exactly this internal use)
   * but NEVER included in this method's own return value or audit-log payload —
   * only the resulting Account Link URL, which the engineer relays to the tenant
   * to complete (Stripe Connect onboarding collects the tenant's OWN business/
   * banking details; Platform Admin cannot fill this in on the tenant's behalf).
   * This keeps "Billing/Payments Ops... never sees a decrypted secret" true in
   * spirit even though a Connect Account id isn't itself a decrypted secret (see
   * PLATFORM_ADMIN_PAYMENT_ACCOUNT_SELECT's own comment on that same
   * conservative-default reasoning).
   *
   * Deliberately NOT built here, each a genuinely separate question the spec
   * doesn't resolve (flagged, not guessed at): step-up MFA for this specific
   * action (no step-up-MFA mechanism exists anywhere in the Platform Admin realm
   * today — only the Cognito Pool's own Required-MFA login gate, which already
   * covers every Platform Admin action, not a per-action additional factor); and
   * rotation for the AWS Secrets Manager fallback path (Spec 55 §4.5/§10.4) —
   * nothing in this codebase integrates Secrets Manager yet, so there is nothing
   * to rotate there, and the STRIPE-provider-only gate above correctly keeps this
   * method from ever reaching that unbuilt path.
   *
   * FOUND ON REVIEW, consciously accepted rather than silently left as a gap: no
   * per-endpoint rate limit beyond AppModule's own global ThrottlerGuard default —
   * matches the exact same posture PaymentsService.initiateConnectOnboarding()
   * already has (also unthrottled beyond the global default), not a regression
   * this phase introduces. Low actual risk either way: repeated calls only ever
   * issue additional short-lived, single-use Account Links against the SAME
   * already-existing Connected Account — never revokes or replaces it — so a
   * flood of calls produces harmless unused links, not a destructive or
   * state-corrupting effect. Worth a dedicated per-action rate limit if Platform
   * Admin session compromise becomes a specifically modeled threat, not assumed
   * necessary here.
   */
  async initiateCredentialRotation(callerId: string, paymentAccountId: string) {
    await this.assertBillingOrFullAdmin(callerId);

    const account = await this.prismaPlatformAdmin.paymentAccount.findUnique({
      where: { id: paymentAccountId },
      select: PLATFORM_ADMIN_PAYMENT_ACCOUNT_ROTATION_SELECT,
    });
    if (!account) {
      throw new NotFoundException('PaymentAccount not found');
    }
    if (account.provider !== 'STRIPE') {
      throw new BadRequestException('Only a STRIPE-provider PaymentAccount has a Stripe Connect credential to rotate.');
    }
    if (!account.stripeConnectedAccountId) {
      throw new BadRequestException(
        'This PaymentAccount has not completed Stripe Connect onboarding yet — there is no existing credential to rotate.',
      );
    }

    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL;
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL;
    if (!returnUrl || !refreshUrl) {
      throw new Error('STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL are not set');
    }

    const stripe = this.stripeClient.platformClient();
    const link = await stripe.accountLinks.create({
      account: account.stripeConnectedAccountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.ROTATE_PAYMENT_ACCOUNT_CREDENTIAL,
      targetType: 'PaymentAccount',
      targetId: account.id,
      schoolId: account.schoolId,
      franchiseId: account.franchiseId,
    });

    return { onboardingUrl: link.url };
  }
}
