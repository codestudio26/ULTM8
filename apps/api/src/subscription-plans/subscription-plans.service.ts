import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { FranchisesService } from '../tenants/franchises/franchises.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { AuditLogService, AuditAction } from '../platform-admin/audit-log.service';
import { cursorPaginate } from '../common/pagination/cursor-paginate';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';

type TenantKind = 'SCHOOL' | 'FRANCHISE';

/**
 * SubscriptionPlansModule (Phase 54, ultm8-nestjs-module §5) — Plan CRUD (Platform
 * Admin authoring), and the Franchise/School subscribe/cancel flow against ULTM8's
 * own platform Stripe account. One service backs both the tenant-facing read/
 * subscribe/cancel surface and the Platform-Admin-gated authoring CRUD, the same
 * deliberate "one service, not two" deviation TranslationsService's own header
 * comment already documents and justifies for SubscriptionPlan's identical no-RLS
 * shape (see that model's own schema.prisma comment).
 *
 * subscribe()/cancel() are intentionally School/Franchise-scoped routes
 * (`schools/:schoolId/subscription-plans/:planId/subscribe`, not the spec's own
 * literal `POST /plans/{id}/subscribe`) — Spec 55 §7's own header names its endpoint
 * table "a starting contract, not a final OpenAPI spec", and this codebase's real,
 * already-shipped convention for "this resource can belong to either a School or a
 * Franchise" is a split route pair (PaymentsController's own
 * createForSchool/createForFranchise), not a single body-discriminated endpoint —
 * followed here for the same reason TranslationsModule's own `platform-admin/*` (not
 * `/admin/*`) routing already picked the real shipped convention over the skill
 * table's own "representative, not final" wording. See SubscriptionPlansController's
 * own header comment for the full account.
 *
 * The Stripe Subscription this creates runs against
 * `StripeClientService.platformClient()` — never `scopedClient()` — because the
 * money flows the opposite direction from every other Stripe integration in this
 * codebase so far: ULTM8 IS the merchant of record here (Spec 55 §6.1/§10.2:
 * "ULTM8 charges the Franchise/School directly for platform access... not a plan
 * the Franchise resells onward", Decision 106), not a tenant's own Connected
 * Account. Mirrors PaymentsService.subscribe()'s exact Stripe Subscription shape
 * (throwaway Customer + Product, inline `price_data`, `payment_behavior:
 * 'default_incomplete'`, `expand: ['latest_invoice.payment_intent']`) — same
 * known-limitation disclosure that method's own header comment already gives
 * (throwaway Customer/Product per subscription, no saved-payment-method reuse;
 * out of scope to build here for the same reason).
 */
@Injectable()
export class SubscriptionPlansService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly franchisesService: FranchisesService,
    private readonly stripeClient: StripeClientService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read — tenant-facing, JwtAuthGuard-gated (SubscriptionPlansController). Not
  // RLS-scoped — SubscriptionPlan has no tenant column (see model's own comment).
  // ---------------------------------------------------------------------------

  async findAll(cursor: string | undefined, limit: number | undefined) {
    return cursorPaginate((args) => this.prismaApp.subscriptionPlan.findMany(args), cursor, limit);
  }

  // ---------------------------------------------------------------------------
  // Authoring CRUD — FULL_ADMIN only (PlatformAdminSubscriptionPlansController).
  // No delete — see the model's own schema.prisma comment for why.
  // ---------------------------------------------------------------------------

  private async assertFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may author SubscriptionPlans.');
    }
  }

  async create(callerId: string, dto: CreateSubscriptionPlanDto) {
    await this.assertFullAdmin(callerId);

    const created = await this.prismaApp.subscriptionPlan.create({
      data: { name: dto.name, description: dto.description, price: dto.price, featureList: dto.featureList ?? [] },
    });

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.CREATE_SUBSCRIPTION_PLAN,
      targetType: 'SubscriptionPlan',
      targetId: created.id,
    });

    return created;
  }

  async update(callerId: string, id: string, dto: UpdateSubscriptionPlanDto) {
    await this.assertFullAdmin(callerId);

    // No manual existence check — same reasoning TranslationsService.update()'s own
    // comment gives: a P2025 on a nonexistent id is already a clean 404 via the
    // global HttpExceptionFilter.
    const updated = await this.prismaApp.subscriptionPlan.update({ where: { id }, data: dto });

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.UPDATE_SUBSCRIPTION_PLAN,
      targetType: 'SubscriptionPlan',
      targetId: updated.id,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Subscribe / cancel — caller-scoped, School Owner/Manager or Franchise Owner
  // only. Both kinds share the exact same mechanics (only which tenant
  // table/ownership-check applies differs), so both public methods below delegate
  // to one private core rather than duplicating the Stripe-call logic twice.
  // ---------------------------------------------------------------------------

  async subscribeSchool(callerId: string, schoolId: string, planId: string) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.subscribe('SCHOOL', callerId, schoolId, planId);
  }

  async subscribeFranchise(callerId: string, franchiseId: string, planId: string) {
    await this.franchisesService.findOne(callerId, franchiseId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);
    return this.subscribe('FRANCHISE', callerId, franchiseId, planId);
  }

  async cancelSchoolSubscription(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.cancel('SCHOOL', callerId, schoolId);
  }

  async cancelFranchiseSubscription(callerId: string, franchiseId: string) {
    await this.franchisesService.findOne(callerId, franchiseId);
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);
    return this.cancel('FRANCHISE', callerId, franchiseId);
  }

  /** Caller's own ownership check has already run in the public method above —
   * this only does the plan lookup, the "already subscribed" guard, and the Stripe
   * Subscription creation itself. */
  private async subscribe(kind: TenantKind, callerId: string, tenantId: string, planId: string) {
    const plan = await this.prismaApp.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException('SubscriptionPlan not found');
    }

    const current = await this.findTenantSubscriptionState(kind, callerId, tenantId);
    // Mirrors domain-rules §6/§8's confirmed "a Student cannot hold two
    // simultaneous Active general-access Memberships" shape, applied analogously
    // to the platform-subscription relationship — Spec 55 never states this
    // explicitly for SubscriptionPlan (no confirmed plan-change/upgrade mechanic
    // exists anywhere in the confirmed material), so blocking a second concurrent
    // subscribe attempt outright, rather than guessing at upgrade/downgrade
    // semantics Decision-log entries like 84's own "flagged, not silently assumed"
    // pattern would want reviewed, is the safe reasonable-minimum call. A CANCELED
    // (or never-subscribed) tenant may always subscribe fresh.
    if (current.platformSubscriptionStatus === 'ACTIVE' || current.platformSubscriptionStatus === 'PAST_DUE') {
      throw new BadRequestException(`This ${kind === 'SCHOOL' ? 'School' : 'Franchise'} already has an active platform subscription — plan changes are not supported yet.`);
    }

    const stripe = this.stripeClient.platformClient();
    const customer = await stripe.customers.create({ name: `Platform subscription — ${kind} ${tenantId}` });
    const product = await stripe.products.create({ name: plan.name });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: 'usd', // domain-rules §7/§11.2, Decision 7 — ULTM8's own revenue is always the single USD anchor currency
            unit_amount: plan.price,
            recurring: { interval: 'month' },
            product: product.id,
          },
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });
    const invoice = subscription.latest_invoice as { payment_intent?: { id: string; client_secret: string } };
    const paymentIntent = invoice?.payment_intent;
    if (!paymentIntent) {
      throw new Error('Stripe Subscription did not return an expandable latest_invoice.payment_intent');
    }

    await this.updateTenantSubscriptionState(kind, callerId, tenantId, {
      subscriptionPlanId: plan.id,
      stripePlatformSubscriptionId: subscription.id,
      platformSubscriptionStatus: 'ACTIVE',
    });

    return { subscriptionId: subscription.id, clientSecret: paymentIntent.client_secret };
  }

  private async cancel(kind: TenantKind, callerId: string, tenantId: string) {
    const current = await this.findTenantSubscriptionState(kind, callerId, tenantId);
    if (!current.stripePlatformSubscriptionId || current.platformSubscriptionStatus === 'CANCELED') {
      throw new BadRequestException(`This ${kind === 'SCHOOL' ? 'School' : 'Franchise'} has no active platform subscription to cancel.`);
    }

    // Spec 55 §10.2's confirmed cancel_at_period_end behavior (no proration, no
    // immediate cutoff) — same mechanism Membership's own Subscription cancellation
    // already uses. platformSubscriptionStatus is NOT flipped here — it stays
    // ACTIVE/PAST_DUE until stripe-webhook-processing's own
    // customer.subscription.deleted handler flips it to CANCELED once Stripe
    // actually ends the period, the same "don't locally guess at Stripe's own
    // timing" discipline every other cancellation flow in this codebase follows.
    const stripe = this.stripeClient.platformClient();
    const updated = await stripe.subscriptions.update(current.stripePlatformSubscriptionId, { cancel_at_period_end: true });
    const cancelsAt = updated.cancel_at ? new Date(updated.cancel_at * 1000) : new Date();
    return { cancelsAt: cancelsAt.toISOString() };
  }

  private async findTenantSubscriptionState(kind: TenantKind, callerId: string, tenantId: string) {
    if (kind === 'SCHOOL') {
      return this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.school.findUniqueOrThrow({
          where: { id: tenantId },
          select: { stripePlatformSubscriptionId: true, platformSubscriptionStatus: true },
        }),
      );
    }
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchise.findUniqueOrThrow({
        where: { id: tenantId },
        select: { stripePlatformSubscriptionId: true, platformSubscriptionStatus: true },
      }),
    );
  }

  private async updateTenantSubscriptionState(
    kind: TenantKind,
    callerId: string,
    tenantId: string,
    data: { subscriptionPlanId: string; stripePlatformSubscriptionId: string; platformSubscriptionStatus: 'ACTIVE' },
  ) {
    if (kind === 'SCHOOL') {
      await this.prismaApp.withTenantContext(callerId, (tx) => tx.school.update({ where: { id: tenantId }, data }));
      return;
    }
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.franchise.update({ where: { id: tenantId }, data }));
  }
}
