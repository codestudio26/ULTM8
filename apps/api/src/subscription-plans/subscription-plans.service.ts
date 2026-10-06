import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

    // FOUND ON REVIEW (V1 Stress Test Round 3) — the check above (`current.
    // platformSubscriptionStatus === 'ACTIVE' || 'PAST_DUE'`) and this write are
    // two separate, unsynchronized steps with a real Stripe network call in
    // between: a genuine TOCTOU window. Two concurrent subscribe() calls for the
    // SAME School/Franchise (a double-click, or two tabs) can both read
    // `current` as not-yet-subscribed, both pass the guard, both reach this
    // point having each created their OWN real Stripe Subscription, and both
    // then try to write their own id onto the same row — plain last-write-wins
    // would silently orphan the loser's Subscription (cancel() only ever looks
    // at the ONE stripePlatformSubscriptionId column, so the loser's
    // Subscription would have no code path that can ever cancel it again — a
    // real, ongoing money leak, not a cosmetic race).
    //
    // Closed the same way Round 2 closed the analogous Membership-purchase
    // collision (resolveMembershipCollision, stripe-webhook-processing.
    // processor.ts): let the race reach Stripe (nothing here can prevent that
    // without inventing a lock Spec 55 never asks for), then make the DB write
    // itself atomic and conditional — `updateMany` with the identical
    // not-ACTIVE/PAST_DUE guard the check above already uses, so only ONE of
    // the two concurrent calls can ever claim the row — and clean up the
    // loser's now-unreachable Stripe side effect instead of abandoning it.
    const claimed = await this.claimTenantSubscriptionSlot(kind, callerId, tenantId, {
      subscriptionPlanId: plan.id,
      stripePlatformSubscriptionId: subscription.id,
      platformSubscriptionStatus: 'ACTIVE',
    });
    if (!claimed) {
      await stripe.subscriptions.cancel(subscription.id);
      throw new ConflictException(
        `This ${kind === 'SCHOOL' ? 'School' : 'Franchise'} already has an active platform subscription — plan changes are not supported yet.`,
      );
    }

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

  /**
   * V1 Stress Test Round 3 — the atomic, conditional half of the fix for the
   * concurrent-subscribe race `subscribe()`'s own comment above describes in
   * full. An `updateMany` with the SAME not-ACTIVE/PAST_DUE guard the earlier
   * fast-path check used, re-checked here against whatever the row's CURRENT
   * state actually is at write time (not the possibly-stale `current` read
   * from before the Stripe call) — Postgres's own row-level locking inside this
   * single UPDATE statement is what actually closes the window, the same
   * mechanism PaymentsService.confirmTransaction()'s own header comment already
   * documents using for its own "conditional update, not create+catch"
   * idempotency guard. Returns whether THIS call's write actually landed
   * (`count === 1`) — `false` means a concurrent call already claimed the slot
   * first, and `subscribe()`'s own caller is responsible for cancelling the
   * Stripe Subscription this call already created rather than leaving it
   * orphaned.
   *
   * FOUND ON REVIEW while writing this: a first draft used a bare
   * `platformSubscriptionStatus: { notIn: ['ACTIVE', 'PAST_DUE'] } }` filter —
   * verified empirically against this sandbox's own real Postgres (not assumed
   * from memory) to NOT match `NULL`, standard SQL three-valued-logic
   * (`NULL NOT IN (...)` evaluates to `NULL`, not `TRUE`, and Prisma's `notIn`
   * compiles directly to that, with no implicit `OR col IS NULL`). Since `null`
   * is the ordinary, universal starting state for every School/Franchise that
   * has never subscribed (the only rows this method is ever actually called
   * for — `subscribe()`'s own fast-path check above already rejects an
   * ACTIVE/PAST_DUE one before Stripe is ever called), that draft would have
   * made every normal, non-racing subscribe() call spuriously lose its own
   * "race" against nothing and get a 409 — worse than the bug being fixed.
   * Guarded explicitly below instead.
   */
  private async claimTenantSubscriptionSlot(
    kind: TenantKind,
    callerId: string,
    tenantId: string,
    data: { subscriptionPlanId: string; stripePlatformSubscriptionId: string; platformSubscriptionStatus: 'ACTIVE' },
  ): Promise<boolean> {
    const notActiveOrPastDue = {
      OR: [
        { platformSubscriptionStatus: null },
        { platformSubscriptionStatus: { notIn: ['ACTIVE' as const, 'PAST_DUE' as const] } },
      ],
    };
    if (kind === 'SCHOOL') {
      const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.school.updateMany({ where: { id: tenantId, ...notActiveOrPastDue }, data }),
      );
      return count === 1;
    }
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchise.updateMany({ where: { id: tenantId, ...notActiveOrPastDue }, data }),
    );
    return count === 1;
  }
}
