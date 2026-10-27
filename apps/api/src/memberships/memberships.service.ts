import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { PaymentsService, NoSavedPaymentMethodError } from '../payments/payments.service';
import { GuardiansService } from '../guardians/guardians.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { StepUpService } from '../auth/step-up.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE } from '../jobs/queue.constants';
import { MembershipPlanPriceMigrationJobData } from '../jobs/membership-plan-price-migration.types';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import { PurchaseMembershipDto } from './dto/purchase-membership.dto';
import { GiftFriendPassDto, SellMembershipDto } from './dto/desk-membership.dto';
import {
  assertCanCreateMembership,
  GeneralAccessConflictError,
  isMembershipLive,
  TRIAL_MAX_DAYS,
  TrialAllowanceError,
} from './membership-creation-guard';
import { CURRENCIES } from '../settings/constants/currencies';
import { StripeClientService } from '../payments/stripe-client.service';
import { cancelSubscriptionAtPeriodEnd } from './cancel-subscription';

// Types a Cash/Bank-eligible MembershipPlan may be — everything except SUBSCRIPTION,
// which requires Stripe (Spec 55 §6.1: "requires Stripe as the payment method when
// type=Subscription... auto-recurring billing has no Cash/Bank Transfer equivalent").
const CASH_BANK_ELIGIBLE_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS', 'TRIAL_MEMBERSHIP'] as const;

// Re-exported: grading and curriculum import it from here.
export { isMembershipLive };

/** How long two purchases of the same plan by the same student count as one
 * (a double click) at Stripe. A later purchase gets a new key. */
const PURCHASE_KEY_WINDOW_MS = 2 * 60 * 1000;

/** The Stripe idempotency key for a card purchase (see createStripeOrder).
 * `sent` is what the purchase sends Stripe (price, currency, title...): Stripe
 * refuses a reused key with different values, so an owner editing the plan
 * between two clicks gets a new key instead of an error. */
export function stripePurchaseKey(studentId: string, planId: string, kind: 'subscription' | 'card' | 'checkout', sent: unknown[]): string {
  const values = createHash('sha256').update(JSON.stringify(sent)).digest('hex').slice(0, 12);
  return `membership-purchase-${kind}-${studentId}-${planId}-${values}-${Math.floor(Date.now() / PURCHASE_KEY_WINDOW_MS)}`;
}

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly paymentsService: PaymentsService,
    private readonly guardiansService: GuardiansService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly stepUpService: StepUpService,
    @InjectQueue(MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE) private readonly priceMigrationQueue: Queue,
    private readonly stripeClient: StripeClientService,
  ) {}

  // ---------------------------------------------------------------------------
  // MembershipPlan CRUD — School Owner/Manager only (Spec §8.2), same gate as
  // ClassesService.
  // ---------------------------------------------------------------------------

  async createPlan(callerId: string, schoolId: string, dto: CreateMembershipPlanDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const title = this.normalizeTitle(dto.title);
    const currency = this.normalizeCurrency(dto.currency);
    // Decision 334 (Memberships review M2-M4): fields a type doesn't use are
    // refused, and the ones it needs are required.
    const shape = this.resolvePlanShape(
      dto.type,
      { expiryDurationDays: dto.expiryDurationDays ?? null, classesIncluded: dto.classesIncluded ?? null, scopedClassId: dto.scopedClassId ?? null },
      dto,
      { expiry: true, credits: true },
    );
    this.assertValidPlanShape(dto.type, dto.price, shape.classesIncluded ?? undefined, shape.scopedClassId ?? undefined);
    this.assertValidNewMemberBillingStrategy(dto.type, dto.newMemberBillingStrategy ?? 'FRESH_CYCLE', dto.billingCycleAnchorDay);

    if (shape.scopedClassId) {
      await this.assertScopedClassSellable(callerId, schoolId, shape.scopedClassId);
    }

    if (dto.disciplineIds) await this.assertStylesOfSchool(callerId, schoolId, dto.disciplineIds);
    const price = dto.type === 'FRIEND_PASS' ? 0 : dto.price;

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.create({
        data: {
          id,
          schoolId,
          type: dto.type,
          title,
          price,
          currency,
          expiryDurationDays: shape.expiryDurationDays,
          classesIncluded: shape.classesIncluded,
          scopedClassId: shape.scopedClassId,
          visible: dto.visible ?? true,
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired ?? false,
          disciplineIds: dto.disciplineIds ?? [],
          // Decision 195: on by default for a priced plan, off for a free one.
          includesLessons: dto.includesLessons ?? price > 0,
          newMemberBillingStrategy: dto.newMemberBillingStrategy ?? 'FRESH_CYCLE',
          billingCycleAnchorDay: dto.billingCycleAnchorDay,
        },
      }),
    );
  }

  // FOUND ON REVIEW (Track B Slice 4a): this read had no role gate at all, unlike
  // createPlan/updatePlan right above it. School's own RLS already blocks a total
  // stranger with no RoleGrant here at all, but any enrolled Student or Staff/
  // Instructor — anyone holding ANY RoleGrant at this School — could still list every
  // plan including ones with visible=false, when only School Owner/Manager should
  // (same gate its CRUD siblings already enforce). The Discovery-facing read
  // (AcademiesService.findOne, prismaDiscovery) is the correct visible-only path for
  // Students browsing; this endpoint is the Owner/Manager management surface.
  async findAllPlans(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.membershipPlan.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
  }

  async findOnePlan(callerId: string, planId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) => tx.membershipPlan.findUnique({ where: { id: planId } }));
    if (!found) {
      throw new NotFoundException('MembershipPlan not found');
    }
    return found;
  }

  async updatePlan(callerId: string, planId: string, dto: UpdateMembershipPlanDto) {
    const existing = await this.findOnePlan(callerId, planId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    // FOUND ON REVIEW (Phase 18): `classesIncluded` is deliberately NOT among
    // UpdateMembershipPlanDto's null-widened fields (see that DTO's own header
    // comment) — its value is resolved jointly with type/scopedClassId via
    // `resolveClassesIncluded()` below, not forwarded directly, so there's no
    // single well-defined "clear" semantics for it the way there is for
    // currency/expiryDurationDays/scopedClassId/cancellationCharge. But
    // `@IsOptional()` (inherited from PartialType(CreateMembershipPlanDto),
    // which was never told to reject null here) still lets a raw
    // `{"classesIncluded": null}` PATCH body pass validation — and
    // `dto.classesIncluded ?? existing.classesIncluded` below would then
    // silently resolve `null` back to the OLD value instead of erroring,
    // exactly the "looks saved, nothing changed" bug this phase's review
    // caught and fixed for other fields elsewhere. Rejected explicitly here
    // instead, the same defensive pattern InstructorsService.update() already
    // established for its own not-nullable `specializations` field.
    if (dto.classesIncluded === null) {
      throw new BadRequestException('classesIncluded cannot be null — omit the field to leave it unchanged.');
    }

    const nextType = dto.type ?? existing.type;
    const typeChanged = dto.type !== undefined && dto.type !== existing.type;
    // Decision 334 (Memberships review M14): the type decides what a live
    // member's Membership means (credits, expiry, renewal), so it is locked
    // while anyone holds one. Duplicating the plan is the way to sell a
    // different type.
    if (typeChanged) {
      const liveMembers = await this.countLiveMembers(callerId, planId);
      if (liveMembers > 0) {
        throw new ConflictException(
          `This plan has ${liveMembers} active member(s), so its type can't change. Create a new plan for the new type instead.`,
        );
      }
    }
    const title = dto.title !== undefined ? this.normalizeTitle(dto.title) : undefined;
    const currencyGiven = dto.currency !== undefined;
    const nextCurrency = currencyGiven ? this.normalizeCurrency(dto.currency) ?? null : existing.currency;
    const currencyChanged = currencyGiven && (nextCurrency ?? '').toUpperCase() !== (existing.currency ?? '').toUpperCase();

    // FOUND ON REVIEW: validate against the FORCED values (0 / 1 for FRIEND_PASS),
    // not the raw incoming ones — an earlier draft validated nextPrice/
    // nextClassesIncluded before forcing, so `PATCH { type: 'FRIEND_PASS' }` alone
    // (price/classesIncluded omitted, carrying forward a non-zero/non-1 existing
    // value) was wrongly rejected as invalid, even though the write below would
    // have forced them correctly. Mirror createPlan's own create-time shape exactly.
    const nextPrice = nextType === 'FRIEND_PASS' ? 0 : dto.price ?? existing.price;
    // Decision 334 (Memberships review M2/M4): a type change clears the fields
    // the new type doesn't use (Class Pack -> Subscription used to keep its 10
    // credits). Required fields are only checked when this edit touches them or
    // the type, so a legacy plan can still have e.g. Visible toggled.
    const shapeTouched =
      dto.type !== undefined || dto.expiryDurationDays !== undefined || dto.classesIncluded !== undefined || dto.scopedClassId !== undefined;
    const shape = this.resolvePlanShape(
      nextType,
      {
        expiryDurationDays: dto.expiryDurationDays !== undefined ? dto.expiryDurationDays : existing.expiryDurationDays,
        classesIncluded: dto.classesIncluded !== undefined ? dto.classesIncluded : existing.classesIncluded,
        scopedClassId: dto.scopedClassId !== undefined ? dto.scopedClassId : existing.scopedClassId,
      },
      dto,
      {
        expiry: dto.type !== undefined || dto.expiryDurationDays !== undefined,
        credits: dto.type !== undefined || dto.classesIncluded !== undefined || dto.scopedClassId !== undefined,
      },
    );
    this.assertValidPlanShape(nextType, nextPrice, shape.classesIncluded ?? undefined, shape.scopedClassId ?? undefined);
    // Decision 259 — validated against the resolved NEXT combination, same
    // discipline as nextType/nextPrice above: a PATCH that only changes type
    // away from SUBSCRIPTION while an existing PRORATED_TO_SHARED_CYCLE/
    // billingCycleAnchorDay combination carries forward unchanged must still
    // be caught, not just a request that touches these two fields directly.
    const nextNewMemberBillingStrategy = dto.newMemberBillingStrategy ?? existing.newMemberBillingStrategy;
    const nextBillingCycleAnchorDay = dto.billingCycleAnchorDay !== undefined ? dto.billingCycleAnchorDay : existing.billingCycleAnchorDay;
    this.assertValidNewMemberBillingStrategy(nextType, nextNewMemberBillingStrategy, nextBillingCycleAnchorDay);

    if (dto.disciplineIds) await this.assertStylesOfSchool(callerId, existing.schoolId, dto.disciplineIds);

    // Only a new scope is checked: re-saving a plan for a class that has since
    // taken place must still work for its other fields.
    if (dto.scopedClassId && shape.scopedClassId && dto.scopedClassId !== existing.scopedClassId) {
      await this.assertScopedClassSellable(callerId, existing.schoolId, shape.scopedClassId);
    }

    // Write the already-resolved next* values whenever ANY field that could affect
    // them changed — not `dto.type === 'FRIEND_PASS'` alone (a second instance of
    // the same bug the comment above just fixed on the validation side: a
    // price-only PATCH against an EXISTING FRIEND_PASS plan must still force price
    // back to 0, even though dto.type itself is undefined on that request).
    const priceOrTypeChanged = dto.price !== undefined || dto.type !== undefined;

    // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
    // prompt. Only SUBSCRIPTION-staying-SUBSCRIPTION edits are in scope — a
    // type change away from/into SUBSCRIPTION alongside a price change is a
    // separate, pre-existing gap this feature doesn't attempt to also solve
    // (flagged, not silently handled). `priceChanged` is the forced/resolved
    // nextPrice vs. the stored price, not the raw dto.price — same "validate
    // against the forced value" discipline this method's own FRIEND_PASS
    // comment above already established.
    const priceChanged = existing.type === 'SUBSCRIPTION' && nextType === 'SUBSCRIPTION' && priceOrTypeChanged && nextPrice !== existing.price;
    const subscriberCount = priceChanged || currencyChanged ? await this.countSubscribers(callerId, planId) : 0;
    // Decision 334 (Memberships review M12): a running Stripe subscription
    // can't switch currency, so neither can its plan.
    if (currencyChanged && subscriberCount > 0) {
      throw new BadRequestException(
        `This plan has ${subscriberCount} active subscription(s) billed in ${existing.currency ?? 'its current currency'}, so its currency can't change. Create a new plan instead.`,
      );
    }
    let stripeProductId: string | undefined;
    let stripePriceId: string | null | undefined;
    const affectedMembershipCount = priceChanged ? subscriberCount : 0;
    if (priceChanged && affectedMembershipCount > 0) {
      // A brand-new/never-subscribed plan has nothing to migrate or
      // grandfather — no choice is required, and no decision row is created;
      // the price simply changes, same as any other field edit.
      if (!dto.priceChangeStrategy) {
        throw new BadRequestException(
          `This SUBSCRIPTION plan has ${affectedMembershipCount} active subscriber(s) — choose priceChangeStrategy ("MIGRATE" or "GRANDFATHER") before changing its price.`,
        );
      }
      const chargeCurrency = await this.resolveChargeCurrency(callerId, existing.schoolId, nextCurrency);
      const connectedAccountId = await this.paymentsService.getStripeConnectedAccountId(callerId, existing.schoolId);
      const created = await this.paymentsService.createPriceForPlan(connectedAccountId, {
        existingProductId: existing.stripeProductId,
        productName: title ?? existing.title,
        amount: nextPrice,
        currency: chargeCurrency.toLowerCase(),
      });
      stripeProductId = created.productId;
      stripePriceId = created.priceId;
    } else if (dto.priceChangeStrategy) {
      // FOUND ON REVIEW: a strategy sent when nothing actually requires one
      // (price unchanged, or this isn't a SUBSCRIPTION-staying-SUBSCRIPTION
      // edit) is rejected rather than silently ignored — the same "a
      // caller-supplied value with no effect is a caller mistake worth
      // surfacing" discipline this codebase already applies elsewhere (e.g.
      // classesIncluded: null above).
      throw new BadRequestException('priceChangeStrategy was provided but this edit does not change a SUBSCRIPTION plan\'s price — omit it.');
    } else if (typeChanged || currencyChanged || (priceOrTypeChanged && nextPrice !== existing.price)) {
      // Decision 334 (Memberships review M12): a saved Stripe Price carries the
      // old amount and currency. With no subscribers to migrate, drop it so the
      // next purchase is charged at the plan's current price.
      stripePriceId = null;
    }

    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.update({
        where: { id: planId },
        data: {
          type: dto.type,
          title,
          price: priceOrTypeChanged ? nextPrice : undefined,
          currency: currencyGiven ? nextCurrency : undefined,
          expiryDurationDays: shapeTouched ? shape.expiryDurationDays : undefined,
          classesIncluded: shapeTouched ? shape.classesIncluded : undefined,
          scopedClassId: shapeTouched ? shape.scopedClassId : undefined,
          visible: dto.visible,
          // Decision 209: distinguishes omitted (undefined, leave unchanged) from
          // an explicit null (clear) from a real date string — the old
          // `dto.refundFeeDate ? new Date(...) : undefined` ternary treated
          // explicit null the same as omitted, silently swallowing the clear.
          refundFeeDate: dto.refundFeeDate === undefined ? undefined : dto.refundFeeDate === null ? null : new Date(dto.refundFeeDate),
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired,
          disciplineIds: dto.disciplineIds,
          includesLessons: dto.includesLessons,
          newMemberBillingStrategy: dto.newMemberBillingStrategy,
          billingCycleAnchorDay: dto.billingCycleAnchorDay,
          stripeProductId,
          stripePriceId,
        },
      }),
    );

    if (priceChanged && affectedMembershipCount > 0 && dto.priceChangeStrategy) {
      await this.recordPriceChangeDecision(callerId, {
        membershipPlanId: planId,
        schoolId: existing.schoolId,
        decision: dto.priceChangeStrategy,
        oldPrice: existing.price,
        newPrice: nextPrice,
        oldCurrency: existing.currency,
        newCurrency: updated.currency,
        decidedById: callerId,
        affectedMembershipCount,
      });
    }

    return updated;
  }

  /**
   * v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
   * prompt. Records the auditable decision row and, for MIGRATE only,
   * enqueues the bulk Stripe-migration background job
   * (membership-plan-price-migration.processor.ts) — GRANDFATHER needs no
   * further action: MembershipPlan.stripePriceId already points new
   * purchases at the new Price (set by updatePlan() just above), and every
   * EXISTING Membership's own Stripe Subscription is deliberately left
   * untouched, which is already the default outcome of doing nothing further
   * here.
   */
  private async recordPriceChangeDecision(
    callerId: string,
    params: {
      membershipPlanId: string;
      schoolId: string;
      decision: 'MIGRATE' | 'GRANDFATHER';
      oldPrice: number;
      newPrice: number;
      oldCurrency: string | null;
      newCurrency: string | null;
      decidedById: string;
      affectedMembershipCount: number;
    },
  ): Promise<void> {
    const isMigrate = params.decision === 'MIGRATE';
    const id = randomUUID();
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlanPriceChange.create({
        data: {
          id,
          membershipPlanId: params.membershipPlanId,
          schoolId: params.schoolId,
          decision: params.decision,
          oldPrice: params.oldPrice,
          newPrice: params.newPrice,
          oldCurrency: params.oldCurrency,
          newCurrency: params.newCurrency,
          decidedById: params.decidedById,
          affectedMembershipCount: params.affectedMembershipCount,
          // GRANDFATHER resolves immediately — there is genuinely nothing
          // further to do (see this method's own header comment) — MIGRATE
          // starts PENDING and is only ever advanced by the background job.
          status: isMigrate ? 'PENDING' : 'COMPLETED',
          completedAt: isMigrate ? undefined : new Date(),
        },
      }),
    );
    if (isMigrate) {
      await this.priceMigrationQueue.add(
        'migrate',
        { priceChangeId: id } satisfies MembershipPlanPriceMigrationJobData,
        { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }
  }

  /** v1.2 backend backlog — audit trail for the price-change decision log,
   * School Owner/Manager only (same gate as every other MembershipPlan
   * mutation/read). Newest first — a staff member checking "what did we
   * decide last time" cares about the most recent decision first. */
  async findPriceChanges(callerId: string, planId: string) {
    const plan = await this.findOnePlan(callerId, planId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlanPriceChange.findMany({ where: { membershipPlanId: planId }, orderBy: { createdAt: 'desc' } }),
    );
  }

  /** A plan's styles must be this School's (Decision 195). */
  private async assertStylesOfSchool(callerId: string, schoolId: string, disciplineIds: string[]) {
    if (new Set(disciplineIds).size !== disciplineIds.length) {
      throw new BadRequestException('Each style can appear only once.');
    }
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.count({ where: { id: { in: disciplineIds }, schoolId } }),
    );
    if (found !== disciplineIds.length) {
      throw new BadRequestException('disciplineIds must all be styles of this School.');
    }
  }

  // No delete/archive method, by deliberate decision (Decision 253) — a
  // Membership is a real purchase/billing record tied to its Transaction's
  // own Stripe payment/refund/dispute history, treated the same as Waiver's
  // own never-purged exception. Its own ACTIVE/EXPIRED lifecycle already
  // covers "this Membership is over" (Decisions 111/122's force-Expiry
  // paths) without a separate delete/archive layered on top.

  // ---------------------------------------------------------------------------
  // v1.2 backend backlog "Archive action" — School Owner/Manager only, same
  // gate every other MembershipPlan mutation above already uses. Archiving
  // never deletes the row or touches any Membership that references it —
  // see MembershipPlan.archivedAt's own schema.prisma comment for the full
  // "why a timestamp, why not cascade" account.
  // ---------------------------------------------------------------------------

  async archivePlan(callerId: string, planId: string) {
    const existing = await this.findOnePlan(callerId, planId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return existing; // idempotent — archiving an already-archived plan is a no-op, not an error.
    }
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.update({ where: { id: planId }, data: { archivedAt: new Date() } }),
    );
  }

  /** Un-archiving (this build's own call, per the backlog's "your call whether
   * to support it") — kept deliberately simple: the same School-Owner gate,
   * reversing the one flag. No special "was it visible before" restore logic
   * — `visible` is untouched either way, same as it was untouched by
   * archivePlan() itself. */
  async unarchivePlan(callerId: string, planId: string) {
    const existing = await this.findOnePlan(callerId, planId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return existing; // idempotent, same reasoning as archivePlan() above.
    }
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.update({ where: { id: planId }, data: { archivedAt: null } }),
    );
  }

  private assertValidPlanShape(
    type: string,
    price: number,
    classesIncluded: number | undefined,
    scopedClassId: string | undefined,
  ) {
    if (type === 'FRIEND_PASS') {
      if (price !== 0) {
        throw new BadRequestException('FRIEND_PASS price must be 0');
      }
      if (classesIncluded !== undefined && classesIncluded !== 1) {
        throw new BadRequestException('FRIEND_PASS classesIncluded must be 1');
      }
    }
    // FOUND ON REVIEW: a SUBSCRIPTION plan priced at 0 would reach purchase()'s
    // £0-immediate path (Spec 55 §6.1's "any Cash/Bank-eligible plan priced at 0" —
    // never intended to include Subscription, which requires Stripe unconditionally
    // per the same section) and get created Active with frequency=RECURRING but no
    // real Stripe Subscription object behind it — a permanent, unbillable "free
    // forever" Membership nothing will ever Expire, since only a real Stripe
    // subscription.deleted event drives that transition. Reject at the source
    // instead of guessing what a £0 Subscription should mean.
    if (type === 'SUBSCRIPTION' && price === 0) {
      throw new BadRequestException('SUBSCRIPTION plans must be priced above 0 — use TRIAL_MEMBERSHIP for a free offering.');
    }
    if (scopedClassId && classesIncluded !== undefined && classesIncluded > 1) {
      throw new BadRequestException('A plan scoped to one Class is capped at classesIncluded=1 — a one-off Class has only one occurrence.');
    }
  }

  private resolveClassesIncluded(type: string, classesIncluded: number | undefined, scopedClassId: string | undefined) {
    if (type === 'FRIEND_PASS') return 1;
    if (scopedClassId) return classesIncluded ?? 1;
    return classesIncluded;
  }

  /**
   * Decision 334 (Memberships review M2-M4). Which of the type-dependent
   * fields a plan type uses:
   *   - credits (classesIncluded) and a one-class scope: CLASS_PACK and
   *     FRIEND_PASS only. SUBSCRIPTION, WEEKLY_PASS and TRIAL_MEMBERSHIP are
   *     general access, so a credit count would turn them into a Class Pack
   *     at booking time (selectAndConsumeMembership treats null credits as
   *     general access).
   *   - expiry: every type except SUBSCRIPTION, which renews until cancelled.
   * A field the type doesn't use is refused when sent and cleared when only
   * carried over from before a type change. `check` turns on the required-
   * field rules: CLASS_PACK needs credits, WEEKLY_PASS an expiry, and
   * TRIAL_MEMBERSHIP an expiry of 1-30 days (Decisions 54/64).
   */
  private resolvePlanShape(
    type: string,
    values: { expiryDurationDays: number | null; classesIncluded: number | null; scopedClassId: string | null },
    explicit: { expiryDurationDays?: number | null; classesIncluded?: number | null; scopedClassId?: string | null },
    check: { expiry: boolean; credits: boolean },
  ): { expiryDurationDays: number | null; classesIncluded: number | null; scopedClassId: string | null } {
    const usesCredits = type === 'CLASS_PACK' || type === 'FRIEND_PASS';
    const usesExpiry = type !== 'SUBSCRIPTION';
    if (!usesCredits && explicit.classesIncluded != null) {
      throw new BadRequestException(`A ${type} plan gives general access, so it has no class count — omit classesIncluded.`);
    }
    if (!usesCredits && explicit.scopedClassId != null) {
      throw new BadRequestException('Only a CLASS_PACK or FRIEND_PASS plan can be limited to one class — omit scopedClassId.');
    }
    if (!usesExpiry && explicit.expiryDurationDays != null) {
      throw new BadRequestException('A SUBSCRIPTION renews every month until cancelled, so it has no expiry — omit expiryDurationDays.');
    }
    const scopedClassId = usesCredits ? values.scopedClassId : null;
    const classesIncluded = usesCredits
      ? this.resolveClassesIncluded(type, values.classesIncluded ?? undefined, scopedClassId ?? undefined) ?? null
      : null;
    const expiryDurationDays = usesExpiry ? values.expiryDurationDays : null;
    if (check.credits && type === 'CLASS_PACK' && classesIncluded === null) {
      throw new BadRequestException('A CLASS_PACK plan needs classesIncluded (how many classes it gives).');
    }
    if (check.expiry && type === 'WEEKLY_PASS' && expiryDurationDays === null) {
      throw new BadRequestException('A WEEKLY_PASS plan needs expiryDurationDays (how many days it lasts).');
    }
    if (check.expiry && type === 'TRIAL_MEMBERSHIP' && (expiryDurationDays === null || expiryDurationDays > TRIAL_MAX_DAYS)) {
      throw new BadRequestException(`A TRIAL_MEMBERSHIP plan must last between 1 and ${TRIAL_MAX_DAYS} days (expiryDurationDays).`);
    }
    return { expiryDurationDays, classesIncluded, scopedClassId };
  }

  /** Decision 334 (Memberships review M11): a title of only spaces is no title. */
  private normalizeTitle(title: string): string {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new BadRequestException('title cannot be blank.');
    }
    return trimmed;
  }

  /** Decision 334 (Memberships review M11): a currency must be one of the
   * Stripe-supported codes GET /settings/currencies lists (Decision 241),
   * stored upper-case. null stays null (clear on update). */
  private normalizeCurrency(currency: string | null | undefined): string | null | undefined {
    if (currency === undefined || currency === null) return currency;
    const code = currency.trim().toUpperCase();
    if (!CURRENCIES.some((c) => c.code === code)) {
      throw new BadRequestException(`${currency} is not a supported currency — pick one from GET /settings/currencies.`);
    }
    return code;
  }

  /**
   * Decision 334 (Memberships review M6): the currency a purchase is charged
   * in. The plan's own, else the School's default currency. Neither set is
   * refused rather than charged in US dollars, which is what the old
   * `?? 'usd'` fallback did. Upper-case, as stored on Transaction; lower-case
   * it for Stripe.
   */
  private async resolveChargeCurrency(contextUserId: string, schoolId: string, planCurrency: string | null): Promise<string> {
    if (planCurrency) return planCurrency.toUpperCase();
    const school = await this.prismaApp.withTenantContext(contextUserId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { defaultCurrency: true } }),
    );
    if (!school?.defaultCurrency) {
      throw new BadRequestException("This plan has no currency and the School has no default currency set — set one on the plan or the School's settings first.");
    }
    return school.defaultCurrency.toUpperCase();
  }

  /**
   * Decision 334 (Memberships review M15, and Classes review C15): a plan
   * limited to one class can only be made or sold while that class is still to
   * come and not archived.
   */
  private async assertScopedClassSellable(contextUserId: string, schoolId: string, classId: string): Promise<void> {
    const scopedClass = await this.prismaApp.withTenantContext(contextUserId, (tx) =>
      tx.class.findUnique({ where: { id: classId }, select: { schoolId: true, startDate: true, archivedAt: true } }),
    );
    if (!scopedClass || scopedClass.schoolId !== schoolId) {
      throw new BadRequestException('scopedClassId must reference a Class belonging to this School');
    }
    if (scopedClass.archivedAt) {
      throw new BadRequestException('This class has been archived, so a plan for it can no longer be made or sold.');
    }
    if (scopedClass.startDate <= new Date()) {
      throw new BadRequestException('This class has already taken place, so a plan for it can no longer be made or sold.');
    }
  }

  /** Memberships on this plan in effect now (isMembershipLive). */
  private async countLiveMembers(callerId: string, planId: string): Promise<number> {
    const memberships = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membership.findMany({
        where: { membershipPlanId: planId, status: 'ACTIVE' },
        select: { status: true, expiryDate: true, classesRemaining: true },
      }),
    );
    const now = new Date();
    return memberships.filter((m) => isMembershipLive(m, now)).length;
  }

  /** Running Stripe subscriptions on this plan: the ones a price change can
   * migrate or grandfather. */
  private countSubscribers(callerId: string, planId: string): Promise<number> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membership.count({ where: { membershipPlanId: planId, status: 'ACTIVE', stripeSubscriptionId: { not: null } } }),
    );
  }

  /** Decision 259 — see MembershipPlan.newMemberBillingStrategy's own schema
   * comment. Validated against the already-resolved NEXT values (same
   * discipline assertValidPlanShape above and updatePlan()'s own FRIEND_PASS
   * comment already established), not the raw dto, so a partial PATCH that
   * only touches one of the two fields is still checked against a
   * consistent combination. */
  private assertValidNewMemberBillingStrategy(type: string, strategy: string, anchorDay: number | null | undefined) {
    if (strategy === 'PRORATED_TO_SHARED_CYCLE') {
      if (type !== 'SUBSCRIPTION') {
        throw new BadRequestException('newMemberBillingStrategy is only meaningful for SUBSCRIPTION plans.');
      }
      if (anchorDay == null) {
        throw new BadRequestException('billingCycleAnchorDay (1-28) is required when newMemberBillingStrategy is PRORATED_TO_SHARED_CYCLE.');
      }
    } else if (anchorDay != null) {
      throw new BadRequestException('billingCycleAnchorDay is only used when newMemberBillingStrategy is PRORATED_TO_SHARED_CYCLE — omit it otherwise.');
    }
  }

  // ---------------------------------------------------------------------------
  // Purchase (Spec 55 §7/§6.1's Decision-6 creation-timing state machine — see the
  // Phase 9 kickoff prompt §2.1 for the full citation trail).
  // ---------------------------------------------------------------------------

  /**
   * Phase 39 added the same on-behalf-of shape SignWaiverDto (Phase 37) /
   * JoinSchoolDto (Phase 38) already established: `dto.studentId` set to
   * someone other than the caller means a Guardian purchasing for a linked
   * minor, gated by GuardiansService.assertGuardianOfStudent(). Every read
   * and write below runs under the TARGET Student's own tenant context, not
   * the caller's — a no-op for ordinary self-purchase, but load-bearing for
   * a Guardian: MembershipPlan/PaymentAccount both use the broad "any active
   * RoleGrant at this School" RLS shape, and a Guardian holds no RoleGrant of
   * their own to satisfy it (only the target minor does, since Phase 38).
   * Membership/Transaction both use the narrower "School Owner/Manager OR the
   * row's own Student" shape — same substitution, same reasoning
   * WaiversService.sign() already documents for its own writes.
   *
   * This is the true prerequisite Phase 37/38's own follow-up notes named:
   * a Guardian-managed minor had no way to ever hold an Active Membership —
   * self-purchase is categorically impossible (permanently blocked login),
   * and no staff-gifting path exists for anything but FRIEND_PASS (blocked
   * below regardless of caller). Unlocks Guardian-driven Booking creation as
   * a genuinely small follow-on next (selectAndConsumeMembership() already
   * keys purely off the target Student, with zero changes needed there).
   */
  async purchase(callerId: string, planId: string, dto?: PurchaseMembershipDto, stepUpToken?: string) {
    const studentId = dto?.studentId ?? callerId;
    const isGuardianAction = dto?.studentId !== undefined && dto.studentId !== callerId;
    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    }
    // Decision 236's own follow-up — the saved-payment-method endpoints
    // (PaymentsController) are self-only, so a Guardian-driven minor, who
    // never logs in, can never have a saved card to reuse here. Checked
    // early, before any plan/payment-account lookup, same "fail loudly on an
    // unsupported combination rather than silently fall back" discipline the
    // FRIEND_PASS check below already follows.
    if (dto?.payWithSavedCard && isGuardianAction) {
      throw new BadRequestException('Paying with a saved card is not supported for a Guardian-driven purchase — pay with a new card instead.');
    }
    // Decision 243 — the two fresh-card-collection mechanisms are mutually
    // exclusive flags on the same request, same "fail loudly on an
    // unsupported combination rather than silently prefer one" discipline the
    // check above already follows.
    if (dto?.payWithSavedCard && dto?.useHostedCheckout) {
      throw new BadRequestException('payWithSavedCard and useHostedCheckout are mutually exclusive — choose one.');
    }

    const plan = await this.findOnePlan(studentId, planId);
    // v1.2 backend backlog "Archive action" — a developer-level judgment call
    // (not explicitly asked for by the backlog item, which only names the
    // Discovery-facing list): archiving is reasoned as a stronger, intended-
    // permanent retirement than `visible=false` (which does NOT block a
    // direct purchase-by-id today), so a direct purchase attempt against an
    // archived plan's id is rejected outright rather than left reachable.
    if (plan.archivedAt) {
      throw new BadRequestException('This MembershipPlan has been archived and can no longer be purchased.');
    }
    // Decision 334 (Memberships review Q2): a hidden plan is off sale, not
    // only off the list. The owner hides a plan to stop selling it.
    if (!plan.visible) {
      throw new BadRequestException('This plan is not on sale.');
    }
    // Decision 334 (Memberships review M17/M18): only a current Student of
    // the School can hold its Membership. Staff buying as themselves, and a
    // removed Student, are refused.
    await this.assertActiveStudent(studentId, plan.schoolId);
    // Decision 334 (Memberships review M13): a closed School takes no new
    // payments (Decision 110).
    await this.tenantAuth.assertSchoolNotArchived(studentId, plan.schoolId);
    // Spec 55 §10.2's confirmed read-only degraded-portal state — "no new
    // payments" is one of the three actions it explicitly names (Phase 54).
    // Checked under `studentId`'s own RLS context, not `callerId`'s — same
    // "a Guardian caller holds zero RoleGrant anywhere, Decision 92" reasoning
    // BookingsService.bookClass()'s own identical check already documents.
    await this.subscriptionGate.assertNotDegraded(studentId, plan.schoolId);
    // FOUND ON REVIEW: skills/ultm8-domain-rules/SKILL.md §6/§15 confirms Friend
    // Pass is "School-gifted, not purchased" — always staff-attributed
    // (Membership.giftedById), never a Student self-service purchase. Routing it
    // through this same generic Student-facing purchase() (as an earlier draft
    // did) would let a Student self-grant themselves a free guest pass, and
    // nothing would ever set giftedById. The owner gives one with
    // giftFriendPass() (Decision 348). Applies identically to a Guardian-driven
    // attempt — a Guardian buying a Friend Pass FOR a minor is the same
    // self-grant workaround under a different caller.
    if (plan.type === 'FRIEND_PASS') {
      throw new BadRequestException('A Friend Pass is given by the School, not bought. Ask the School for one.');
    }
    // Decision 334 (Memberships review M7): the plan's own "requires a waiver"
    // switch, checked the same way BookingsService.bookClass() checks a
    // Class's: any Signed Waiver at this School.
    if (plan.termsWaiverRequired) {
      const signed = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.waiverSignature.findFirst({ where: { studentId, schoolId: plan.schoolId, status: 'SIGNED' }, select: { id: true } }),
      );
      if (!signed) {
        throw new BadRequestException('This Student must sign this School\'s waiver before buying this plan.');
      }
    }
    if (plan.scopedClassId) {
      await this.assertScopedClassSellable(studentId, plan.schoolId, plan.scopedClassId);
    }
    // Decision 334 (Memberships review M1/M20/M3): checked before any charge,
    // so a Student who can't hold this Membership is never asked to pay. The
    // same check runs again where the Membership is created.
    await this.prismaApp.withTenantContext(studentId, (tx) =>
      assertCanCreateMembership(tx, studentId, plan.schoolId, plan).catch((err) => {
        throw this.toCreationConflict(err);
      }),
    );
    const paymentAccount = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId: plan.schoolId } }),
    );
    if (!paymentAccount) {
      throw new BadRequestException('This School has no configured PaymentAccount — nothing can be purchased here yet.');
    }
    if (plan.type === 'SUBSCRIPTION' && paymentAccount.provider !== 'STRIPE') {
      throw new BadRequestException('SUBSCRIPTION plans require the School to have a STRIPE PaymentAccount — this School is configured for Cash/Bank Transfer only.');
    }
    // Decision 236's own follow-up, scoped deliberately: PaymentsService.
    // subscribe()'s own header comment already flags that it creates a
    // throwaway Stripe Customer on every call, never wired to
    // StudentPaymentMethod — reusing a saved card for a Subscription needs
    // that fixed first, a separate piece of work, not bundled into this one.
    if (dto?.payWithSavedCard && plan.type === 'SUBSCRIPTION') {
      throw new BadRequestException('Paying a Subscription with a saved card is not supported yet — pay with a new card instead.');
    }
    if (dto?.payWithSavedCard && paymentAccount.provider !== 'STRIPE') {
      throw new BadRequestException('Paying with a saved card requires a Stripe-configured School — this School is configured for Cash/Bank Transfer only.');
    }
    // Decision 243 — Track B Slice 4b's hosted-Checkout path, scoped
    // identically to payWithSavedCard's own two checks immediately above
    // (CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP, Stripe-configured School only).
    // Unlike payWithSavedCard, this is NOT rejected for a Guardian-driven
    // purchase — see PurchaseMembershipDto's own header comment for why.
    if (dto?.useHostedCheckout && plan.type === 'SUBSCRIPTION') {
      throw new BadRequestException('Hosted Checkout for a SUBSCRIPTION plan is not supported yet — pay with a new card instead.');
    }
    if (dto?.useHostedCheckout && paymentAccount.provider !== 'STRIPE') {
      throw new BadRequestException('Hosted Checkout requires a Stripe-configured School — this School is configured for Cash/Bank Transfer only.');
    }

    // £0-immediate path (Spec 55 §6.1: "any Cash/Bank-eligible plan priced at 0...
    // created Active immediately, with no Transaction or wait at all"). Only reaches
    // here for a plan the School's own PaymentAccount can actually fulfil without
    // Stripe — a £0 SUBSCRIPTION isn't a real case (Subscription always requires
    // Stripe per the check above, and Stripe subscriptions aren't modeled as £0
    // here), so this branch is effectively FRIEND_PASS/other-zero-priced plans only.
    if (plan.price === 0) {
      return this.createMembershipAndReturn(studentId, plan, null);
    }

    const student = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: studentId }, select: { email: true, paymentRestrictedAt: true } }),
    );
    const currency = await this.resolveChargeCurrency(studentId, plan.schoolId, plan.currency);

    if (paymentAccount.provider === 'STRIPE') {
      // Decision 68/112 — "restricted to Cash/Bank Transfer payment methods only"
      // means exactly this here: payment method is fixed per School
      // (paymentAccount.provider), never a per-purchase Student choice, so there is
      // no alternative to offer at a Stripe-only School — the purchase is blocked
      // outright. A School already configured for Cash/Bank is untouched below;
      // this Student was already paying that way there.
      if (student.paymentRestrictedAt) {
        throw new BadRequestException('This account is restricted to Cash/Bank Transfer payment methods, following a pattern of lost Stripe disputes — this School only accepts Stripe.');
      }
      const transactionId = randomUUID();
      if (plan.type === 'SUBSCRIPTION') {
        // Payment is still collected fresh, client-side, via Stripe Elements
        // against the returned clientSecret (PaymentsService.subscribe()'s own
        // header comment) — whoever completes it does so in THEIR OWN app
        // session (in practice, the Guardian, since the minor can never log
        // in). No persisted PaymentMethod concept exists to select between a
        // Guardian's vs. a minor's "saved card" — see PurchaseMembershipDto's
        // own header comment for why that's not a design gap this phase needs
        // to resolve, only one to flag for whenever that feature is built.
        const { subscriptionId, paymentIntentId, clientSecret } = await this.paymentsService.subscribe(
          studentId,
          plan.schoolId,
          student.email,
          plan.price,
          currency,
          plan.title,
          // v1.2 backend backlog — once a price-change decision has created a
          // persisted Price for this plan, every new purchase attaches to it
          // (see PaymentsService.subscribe()'s own header comment).
          plan.stripePriceId ?? undefined,
          // Decision 259 — see PaymentsService.subscribe()'s own header comment.
          plan.newMemberBillingStrategy === 'PRORATED_TO_SHARED_CYCLE' ? plan.billingCycleAnchorDay ?? undefined : undefined,
          stripePurchaseKey(studentId, plan.id, 'subscription', [
            student.email,
            plan.price,
            currency,
            plan.title,
            plan.stripePriceId,
            plan.newMemberBillingStrategy,
            plan.billingCycleAnchorDay,
          ]),
        );
        const orderId = await this.createStripeOrder(studentId, paymentIntentId, transactionId, (tx) =>
          tx.transaction.create({
            data: {
              id: transactionId,
              schoolId: plan.schoolId,
              studentId,
              paymentAccountId: paymentAccount.id,
              membershipPlanId: plan.id,
              amount: plan.price,
              currency: currency.toUpperCase(),
              status: 'PENDING',
              paymentMethod: 'STRIPE',
              stripePaymentIntentId: paymentIntentId,
              // Membership doesn't exist yet (Decision 6) — stashed here so
              // stripe-webhook-processing's payment_intent.succeeded handler can
              // copy it onto the Membership row it creates.
              stripeSubscriptionId: subscriptionId,
            },
          }),
        );
        return { outcome: 'requires_payment' as const, clientSecret, transactionId: orderId };
      }

      // Decision 236's own follow-up — reuse the saved card (Decision 238)
      // instead of collecting a fresh one, gated by a fresh step-up proof.
      // SUBSCRIPTION already took its own branch above and never reaches
      // here; CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP only.
      if (dto?.payWithSavedCard) {
        return this.purchaseWithSavedCard(studentId, callerId, plan, paymentAccount.id, currency, stepUpToken);
      }

      // Decision 243 (Track B Slice 4b) — hosted Stripe Checkout, the fresh-
      // card path apps/student can actually complete. SUBSCRIPTION already
      // took its own branch above and never reaches here; CLASS_PACK/
      // WEEKLY_PASS/TRIAL_MEMBERSHIP only, same scope as payWithSavedCard.
      if (dto?.useHostedCheckout) {
        return this.purchaseViaHostedCheckout(studentId, plan, paymentAccount.id, currency);
      }

      const { paymentIntentId, clientSecret } = await this.paymentsService.charge(
        studentId,
        plan.schoolId,
        plan.price,
        currency,
        plan.title,
        stripePurchaseKey(studentId, plan.id, 'card', [plan.price, currency, plan.title]),
      );
      const orderId = await this.createStripeOrder(studentId, paymentIntentId, transactionId, (tx) =>
        tx.transaction.create({
          data: {
            id: transactionId,
            schoolId: plan.schoolId,
            studentId,
            paymentAccountId: paymentAccount.id,
            membershipPlanId: plan.id,
            amount: plan.price,
            currency: currency.toUpperCase(),
            status: 'PENDING',
            paymentMethod: 'STRIPE',
            stripePaymentIntentId: paymentIntentId,
          },
        }),
      );
      return { outcome: 'requires_payment' as const, clientSecret, transactionId: orderId };
    }

    // Cash/Bank Transfer path — Transaction created Pending, Membership created
    // later via PaymentsService.confirmTransaction (PATCH /transactions/{id}/confirm).
    if (!CASH_BANK_ELIGIBLE_TYPES.includes(plan.type as (typeof CASH_BANK_ELIGIBLE_TYPES)[number])) {
      throw new BadRequestException(`${plan.type} is not Cash/Bank Transfer-eligible.`);
    }
    // Decision 339 (T10) — one open Cash/Bank payment per Student per plan: a
    // second Buy (a double tap, or a retry because nothing seemed to happen)
    // returns the one already waiting instead of writing another the Owner
    // could confirm twice. The advisory lock serializes two concurrent taps.
    const { transactionId, created } = await this.prismaApp.withTenantContext(studentId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-purchase:${studentId}:${plan.id}`}))`;
      const open = await tx.transaction.findFirst({
        where: { studentId, membershipPlanId: plan.id, status: 'PENDING', paymentMethod: { in: ['CASH', 'BANK_TRANSFER'] } },
        select: { id: true },
      });
      if (open) return { transactionId: open.id, created: false };
      const id = randomUUID();
      await tx.transaction.create({
        data: {
          id,
          schoolId: plan.schoolId,
          studentId,
          paymentAccountId: paymentAccount.id,
          membershipPlanId: plan.id,
          amount: plan.price,
          currency: currency.toUpperCase(),
          status: 'PENDING',
          paymentMethod: paymentAccount.provider,
        },
      });
      return { transactionId: id, created: true };
    });
    if (created) {
      await this.paymentsService.notifyCashPayment(
        { id: transactionId, schoolId: plan.schoolId, studentId, membershipPlanId: plan.id, amount: plan.price, currency },
        'waiting',
      );
    }
    return { outcome: 'pending_confirmation' as const, transactionId };
  }

  /**
   * Decision 236's own follow-up — `purchase()`'s `payWithSavedCard` branch.
   * Gated on a fresh step-up proof (`callerId` here is always `studentId`,
   * since a Guardian-driven `payWithSavedCard` purchase is rejected before
   * this is ever called), then charges the Student's saved payment method
   * (Decision 238's `chargeOffSession()`) synchronously — unlike the fresh-
   * card branch above, there is no client-side confirmation step and no
   * webhook to wait for; the outcome is known immediately.
   */
  private async purchaseWithSavedCard(
    studentId: string,
    callerId: string,
    plan: { id: string; schoolId: string; type: string; classesIncluded: number | null; expiryDurationDays: number | null; scopedClassId: string | null; price: number; title: string },
    paymentAccountId: string,
    currency: string,
    stepUpToken?: string,
  ) {
    this.stepUpService.assertVerified(callerId, stepUpToken);

    let chargeResult: { succeeded: boolean; paymentIntentId: string };
    try {
      chargeResult = await this.paymentsService.chargeOffSession(studentId, plan.schoolId, plan.price, currency, plan.title);
    } catch (err) {
      if (err instanceof NoSavedPaymentMethodError) {
        throw new BadRequestException('You have no saved payment method at this School — add a card first, or pay with a new card.');
      }
      throw err;
    }

    const transactionId = randomUUID();
    if (!chargeResult.succeeded) {
      // Recorded for audit even though it failed — same "a Transaction row
      // always exists once a real charge attempt was made" discipline the
      // fresh-card/Subscription branches already follow (PENDING there,
      // FAILED here since chargeOffSession() already knows the outcome
      // synchronously — no webhook needed to tell this branch what already
      // happened).
      await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.transaction.create({
          data: {
            id: transactionId,
            schoolId: plan.schoolId,
            studentId,
            paymentAccountId,
            membershipPlanId: plan.id,
            amount: plan.price,
            currency: currency.toUpperCase(),
            status: 'FAILED',
            paymentMethod: 'STRIPE',
            stripePaymentIntentId: chargeResult.paymentIntentId || undefined,
          },
        }),
      );
      throw new BadRequestException('Your saved card was declined — try a different payment method.');
    }

    await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.transaction.create({
        data: {
          id: transactionId,
          schoolId: plan.schoolId,
          studentId,
          paymentAccountId,
          membershipPlanId: plan.id,
          amount: plan.price,
          currency: currency.toUpperCase(),
          status: 'SUCCESSFUL',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: chargeResult.paymentIntentId,
        },
      }),
    );

    try {
      const result = await this.createMembershipAndReturn(studentId, plan, null);
      await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.transaction.update({ where: { id: transactionId }, data: { membershipId: result.membership.id } }),
      );
      return { ...result, transactionId };
    } catch (err) {
      if (err instanceof ConflictException) {
        // The charge already succeeded (real money moved) before this
        // Membership-creation race was even attempted — chargeOffSession()
        // runs outside any DB transaction (the same "an external Stripe call
        // has no place holding a DB transaction open" discipline this
        // codebase enforces everywhere else), so there is no transaction to
        // roll the charge back with. Refunded explicitly here rather than
        // left orphaned — see PaymentsService.refundOffSessionCharge()'s own
        // header comment for why this is a synchronous, one-shot refund, not
        // the async webhook path's queued/idempotency-keyed equivalent
        // (resolveMembershipCollision, stripe-webhook-processing.processor.ts).
        await this.paymentsService.refundOffSessionCharge(studentId, plan.schoolId, chargeResult.paymentIntentId);
        await this.prismaApp.withTenantContext(studentId, (tx) =>
          tx.transaction.update({ where: { id: transactionId }, data: { status: 'REFUNDED', refundedAmount: plan.price } }),
        );
        throw new ConflictException(`${err.message} Your saved card was charged and has now been refunded.`);
      }
      throw err;
    }
  }

  /**
   * Decision 243 (Track B Slice 4b) — `purchase()`'s `useHostedCheckout`
   * branch. apps/student has no Stripe SDK dependency (Decision 113/238), so
   * the bare PaymentIntent `clientSecret` the `charge()` branch above returns
   * (`requires_payment`) is a dead end there — nothing in that app can render
   * Stripe Elements/PaymentSheet against it. This instead wraps the identical
   * one-time charge in a hosted Stripe Checkout Session (Decision 238's own
   * `mode: 'setup'` card-saving pattern, extended to `mode: 'payment'`),
   * opened in the device's own browser via `expo-web-browser`.
   *
   * The Transaction created below is, deliberately, shaped EXACTLY like the
   * `charge()` branch's own Transaction — same PENDING/STRIPE/
   * stripePaymentIntentId — because `PaymentsService.
   * createPurchaseCheckoutSession()`'s own header comment confirms a
   * `mode: 'payment'` Checkout Session's underlying PaymentIntent exists
   * synchronously, at Session-creation time. That's what lets this reuse the
   * EXISTING `payment_intent.succeeded` webhook handler
   * (`StripeWebhookProcessingProcessor.handlePaymentIntentSucceeded`)
   * verbatim for Membership creation and collision handling, instead of a
   * second, parallel path keyed off `checkout.session.completed` — no
   * processor change needed for this purchase path at all.
   */
  private async purchaseViaHostedCheckout(
    studentId: string,
    plan: { id: string; schoolId: string; price: number; title: string },
    paymentAccountId: string,
    currency: string,
  ) {
    const { checkoutUrl, paymentIntentId } = await this.paymentsService.createPurchaseCheckoutSession(
      studentId,
      plan.schoolId,
      plan.price,
      currency,
      plan.title,
      stripePurchaseKey(studentId, plan.id, 'checkout', [plan.price, currency, plan.title]),
    );
    const newId = randomUUID();
    const transactionId = await this.createStripeOrder(studentId, paymentIntentId, newId, (tx) =>
      tx.transaction.create({
        data: {
          id: newId,
          schoolId: plan.schoolId,
          studentId,
          paymentAccountId,
          membershipPlanId: plan.id,
          amount: plan.price,
          currency: currency.toUpperCase(),
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: paymentIntentId,
        },
      }),
    );
    return { outcome: 'requires_checkout' as const, checkoutUrl, transactionId };
  }

  /**
   * Saves a card purchase's Pending Transaction. A repeated purchase (a double
   * click) reaches Stripe with the same idempotency key and gets the same
   * PaymentIntent back, which already has its Transaction (stripePaymentIntentId
   * is unique): that one is returned instead of a second. Before, each click
   * opened its own Stripe subscription or Checkout and its own Pending order
   * (billing stress test, 26 Oct 2026, B2).
   */
  private async createStripeOrder(
    studentId: string,
    paymentIntentId: string,
    transactionId: string,
    create: (tx: Parameters<Parameters<PrismaAppService['withTenantContext']>[1]>[0]) => Promise<unknown>,
  ): Promise<string> {
    try {
      await this.prismaApp.withTenantContext(studentId, create);
      return transactionId;
    } catch (err) {
      const unique = Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
      if (!unique) throw err;
      const existing = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } }),
      );
      if (!existing) throw err;
      return existing.id;
    }
  }

  /**
   * Atomicity requirement (Spec 55 §11.5): a Student may not hold two simultaneous
   * Active general-access (Subscription/Weekly Pass) Memberships at the same School.
   * Decision 334 replaced the partial unique index this used to rely on with
   * assertCanCreateMembership(), run in the same transaction as the insert
   * under an advisory lock — see that function's own comment for why.
   */
  async createMembershipAndReturn(studentId: string, plan: { id: string; schoolId: string; type: string; classesIncluded: number | null; expiryDurationDays: number | null; scopedClassId: string | null }, stripeSubscriptionId: string | null) {
    try {
      const membership = await this.prismaApp.withTenantContext(studentId, async (tx) => {
        await assertCanCreateMembership(tx, studentId, plan.schoolId, plan);
        return tx.membership.create({
          data: {
            id: randomUUID(),
            studentId,
            membershipPlanId: plan.id,
            schoolId: plan.schoolId,
            frequency: plan.type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME',
            classesRemaining: plan.classesIncluded ?? undefined,
            expiryDate: plan.expiryDurationDays ? new Date(Date.now() + plan.expiryDurationDays * 24 * 60 * 60 * 1000) : undefined,
            scopedClassId: plan.scopedClassId,
            stripeSubscriptionId: stripeSubscriptionId ?? undefined,
          },
        });
      });
      return { outcome: 'active' as const, membership };
    } catch (err) {
      throw this.toCreationConflict(err);
    }
  }

  /** The guard's two refusals as a 409; anything else unchanged.
   * purchaseWithSavedCard() refunds on any ConflictException. */
  private toCreationConflict(err: unknown): unknown {
    if (err instanceof GeneralAccessConflictError || err instanceof TrialAllowanceError) {
      return new ConflictException(err.message);
    }
    return err;
  }

  /** Decision 334 (Memberships review M17/M18). Read under the Student's own
   * context, which can always see its own RoleGrant. */
  private async assertActiveStudent(studentId: string, schoolId: string): Promise<void> {
    const grant = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!grant) {
      throw new ForbiddenException('Only a current Student of this School can buy its membership plans.');
    }
  }

  // ---------------------------------------------------------------------------
  // Owner actions on a Student's Memberships (Decision 348): sell at the desk,
  // give a Friend Pass, cancel a Subscription, and the two owner lists.
  // ---------------------------------------------------------------------------

  /**
   * The owner records a plan sold at the desk and already paid in cash or by
   * bank transfer. The Membership is created Active at once with a Successful
   * Transaction: the owner confirming the money arrived is the same act
   * PaymentsService.confirmTransaction() performs for a Student's own
   * Cash/Bank order. A Subscription is card-only (Spec 55 §6.1) and a Friend
   * Pass is given, not sold. A hidden plan can be sold here: hiding takes a
   * plan off the Students' list (Decision 334), not off the owner's desk.
   */
  async sellAtDesk(callerId: string, schoolId: string, studentId: string, dto: SellMembershipDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.recordDeskSale(schoolId, studentId, dto, { recordedById: callerId });
  }

  /**
   * The desk sale itself, with every check on the plan and the Student, for
   * a caller already allowed to record it: the owner (sellAtDesk above) or,
   * from the Transactions follow-ups, Branch Staff when the School allows
   * it. The one place a desk sale creates a Membership, so the creation
   * guard (one live general access, trial allowance) always runs. Reads and
   * writes run under the Student's own context, as purchase() does, so it
   * doesn't depend on the recorder's access to Membership or Transaction.
   */
  async recordDeskSale(schoolId: string, studentId: string, dto: SellMembershipDto, { recordedById }: { recordedById: string }) {
    const plan = await this.loadDeskPlan(schoolId, studentId, dto.membershipPlanId);
    if (plan.type === 'FRIEND_PASS') {
      throw new BadRequestException('A Friend Pass is given, not sold. Use Give a Friend Pass instead.');
    }
    if (plan.type === 'SUBSCRIPTION') {
      throw new BadRequestException('A Subscription is paid by card in the app, so it can\'t be sold at the desk.');
    }
    if (plan.termsWaiverRequired) {
      const signed = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.waiverSignature.findFirst({ where: { studentId, schoolId, status: 'SIGNED' }, select: { id: true } }),
      );
      if (!signed) {
        throw new BadRequestException('This Student must sign this School\'s waiver before buying this plan.');
      }
    }
    const paymentAccount = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } }),
    );
    if (plan.price > 0 && !paymentAccount) {
      throw new BadRequestException('Set up this School\'s payments before recording a sale.');
    }
    const currency = plan.price > 0 ? await this.resolveChargeCurrency(studentId, schoolId, plan.currency) : null;

    try {
      return await this.prismaApp.withTenantContext(studentId, async (tx) => {
        await assertCanCreateMembership(tx, studentId, schoolId, plan);
        const membership = await tx.membership.create({ data: this.newMembershipData(studentId, plan) });
        if (plan.price === 0) {
          // Spec 55 §6.1: a £0 plan has no Transaction, as in purchase().
          return { membership, transactionId: null };
        }
        const transaction = await tx.transaction.create({
          data: {
            id: randomUUID(),
            schoolId,
            studentId,
            paymentAccountId: paymentAccount!.id,
            membershipPlanId: plan.id,
            membershipId: membership.id,
            amount: plan.price,
            currency,
            status: 'SUCCESSFUL',
            paymentMethod: dto.paymentMethod,
            recordedById,
          },
          select: { id: true },
        });
        return { membership, transactionId: transaction.id };
      });
    } catch (err) {
      throw this.toCreationConflict(err);
    }
  }

  /** The owner gives a Student a Friend Pass for one guest (Spec 55 §6.1:
   * School-gifted, always £0, staff-attributed through giftedById). The
   * Student uses it when booking a guest (BookingsService.consumeGuestMembership). */
  async giftFriendPass(callerId: string, schoolId: string, studentId: string, dto: GiftFriendPassDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const plan = await this.loadDeskPlan(schoolId, studentId, dto.membershipPlanId);
    if (plan.type !== 'FRIEND_PASS') {
      throw new BadRequestException('Only a Friend Pass plan can be given. Use Sell a plan for the others.');
    }
    try {
      const membership = await this.prismaApp.withTenantContext(studentId, async (tx) => {
        await assertCanCreateMembership(tx, studentId, schoolId, plan);
        return tx.membership.create({ data: { ...this.newMembershipData(studentId, plan), giftedById: callerId } });
      });
      return { membership, transactionId: null };
    } catch (err) {
      throw this.toCreationConflict(err);
    }
  }

  /** Shared checks for the desk actions, after the caller is allowed: open
   * School, a current Student, a plan of this School that isn't archived, and
   * a scoped class that can still be sold. Under the Student's own context. */
  private async loadDeskPlan(schoolId: string, studentId: string, planId: string) {
    const grant = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!grant) {
      throw new BadRequestException('Only a current Student of this School can be given a membership.');
    }
    await this.tenantAuth.assertSchoolNotArchived(studentId, schoolId);
    await this.subscriptionGate.assertNotDegraded(studentId, schoolId);
    const plan = await this.findOnePlan(studentId, planId);
    if (plan.schoolId !== schoolId) {
      throw new NotFoundException('MembershipPlan not found');
    }
    if (plan.archivedAt) {
      throw new BadRequestException('This MembershipPlan has been archived and can no longer be sold.');
    }
    if (plan.scopedClassId) {
      await this.assertScopedClassSellable(studentId, schoolId, plan.scopedClassId);
    }
    return plan;
  }

  private newMembershipData(
    studentId: string,
    plan: { id: string; schoolId: string; type: string; classesIncluded: number | null; expiryDurationDays: number | null; scopedClassId: string | null },
  ) {
    return {
      id: randomUUID(),
      studentId,
      membershipPlanId: plan.id,
      schoolId: plan.schoolId,
      frequency: 'ONE_TIME' as const,
      classesRemaining: plan.classesIncluded ?? undefined,
      expiryDate: plan.expiryDurationDays ? new Date(Date.now() + plan.expiryDurationDays * 24 * 60 * 60 * 1000) : undefined,
      scopedClassId: plan.scopedClassId,
    };
  }

  /**
   * Cancel a Subscription at the end of its paid period (Spec 55 §10.2:
   * cancel_at_period_end, no proration, no immediate cutoff). Allowed to the
   * Student, a Guardian of a linked minor (`onBehalfOfStudentId`), or the
   * School's owner. The Membership stays live until Stripe ends the
   * Subscription; customer.subscription.deleted then expires it and cancels
   * the Bookings it funded, as it already does. Asking twice changes nothing.
   * The Stripe and database work is cancelSubscriptionAtPeriodEnd() in
   * cancel-subscription.ts, which Students S2 (removing a Student) calls too.
   */
  async cancelSubscriptionAtPeriodEnd(callerId: string, membershipId: string, onBehalfOfStudentId?: string) {
    let contextUserId = callerId;
    let membership = await this.prismaApp.withTenantContext(callerId, (tx) => tx.membership.findUnique({ where: { id: membershipId } }));
    if (!membership && onBehalfOfStudentId && onBehalfOfStudentId !== callerId) {
      await this.guardiansService.assertGuardianOfStudent(callerId, onBehalfOfStudentId);
      contextUserId = onBehalfOfStudentId;
      membership = await this.prismaApp.withTenantContext(contextUserId, (tx) => tx.membership.findUnique({ where: { id: membershipId } }));
      if (membership && membership.studentId !== onBehalfOfStudentId) membership = null;
    }
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.studentId !== contextUserId) {
      // Seen through staff access: only the owner may cancel for a Student.
      await this.tenantAuth.assertSchoolOwner(callerId, membership.schoolId);
    }
    const found = membership;
    return this.prismaApp.withTenantContext(contextUserId, (tx) => cancelSubscriptionAtPeriodEnd(this.stripeClient, tx, found, callerId));
  }

  /** Every Membership a Student holds at the School, newest first, for the
   * owner's Student page. */
  async findStudentMemberships(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membership.findMany({
        where: { studentId, schoolId },
        include: { membershipPlan: { select: { title: true, type: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    const now = new Date();
    return {
      items: rows.map(({ membershipPlan, ...m }) => ({ ...m, planTitle: membershipPlan.title, planType: membershipPlan.type, live: isMembershipLive(m, now) })),
    };
  }

  /** Who holds a plan now, for the owner: live Memberships of current
   * Students (the same people getActiveMemberCount() counts), by name. */
  async findPlanMembers(callerId: string, planId: string) {
    const plan = await this.findOnePlan(callerId, planId);
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);
    const now = new Date();
    const { rows, students } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const all = await tx.membership.findMany({ where: { membershipPlanId: planId, status: 'ACTIVE' } });
      const live = all.filter((m) => isMembershipLive(m, now));
      const ids = [...new Set(live.map((m) => m.studentId))];
      const grants = await tx.roleGrant.findMany({
        where: { schoolId: plan.schoolId, role: 'STUDENT', revokedAt: null, userId: { in: ids } },
        select: { userId: true },
      });
      const current = new Set(grants.map((g) => g.userId));
      const users = await tx.user.findMany({ where: { id: { in: [...current] } }, select: { id: true, firstName: true, surname: true } });
      return { rows: live.filter((m) => current.has(m.studentId)), students: new Map(users.map((u) => [u.id, u])) };
    });
    const items = rows.map((m) => ({
      membershipId: m.id,
      studentId: m.studentId,
      firstName: students.get(m.studentId)?.firstName ?? '',
      surname: students.get(m.studentId)?.surname ?? '',
      startDate: m.startDate,
      expiryDate: m.expiryDate,
      classesRemaining: m.classesRemaining,
      cancelAt: m.cancelAt,
      gifted: m.giftedById !== null,
    }));
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`) || a.membershipId.localeCompare(b.membershipId));
    return { items };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findMyMemberships(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.membership.findMany({ ...args, where: { studentId: callerId } }), cursor, limit),
    );
  }

  /**
   * GET /students/{id}/membership-status — Branch Staff-accessible (see
   * TenantAuthorizationService.assertStaffAtSchool's own header comment), computed
   * active/expired signal ONLY, no raw Membership/Transaction row exposure (Spec 55
   * §7/§8.2). `schoolId` is a required query param — not part of the confirmed
   * route literal, but genuinely necessary: a Student's Memberships are School-
   * scoped, and without it this endpoint can't know which School's status to
   * report. Flagged as a Developer-level addition, same class as this phase's other
   * inferred fields.
   */
  async getMembershipStatus(callerId: string, studentId: string, schoolId: string): Promise<'ACTIVE' | 'EXPIRED' | 'NONE'> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    // FOUND ON REVIEW (self-check, second pass): studentId feeds directly into
    // withTenantContext(studentId, ...) below as the RLS tenant context, not just a
    // WHERE-clause value like every other :id param in this codebase — that
    // method's own isUuid() guard throws a bare Error (mapped to a generic 500 by
    // HttpExceptionFilter, not a clean 400) for a malformed id, unlike Prisma's own
    // findUnique-returns-null-for-a-bad-id behavior every other endpoint relies on.
    // No ParseUUIDPipe convention exists anywhere else in this codebase to reuse,
    // so checked explicitly here instead, matching this codebase's own preference
    // for explicit checks over silently letting a downstream throw surface as a
    // confusing error (same reasoning PaymentsController's rawBody/signature checks
    // already established).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
      throw new BadRequestException('id path parameter must be a valid UUID');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    // BUG FOUND ON REVIEW: an earlier draft ran this query under
    // withTenantContext(callerId, ...) — the CALLER's own tenant context. Under
    // Membership's RLS policy (§3b of the Phase 9 kickoff prompt — School Owner/
    // Manager OR the row's own Student, nobody else), a Branch Staff or Instructor
    // caller — this endpoint's whole reason to exist — is neither, so RLS silently
    // returned zero rows for every call, and this endpoint always answered 'NONE'
    // regardless of the Student's real status. assertStaffAtSchool above has
    // already authorized the caller to receive this narrow, computed, non-raw-row
    // signal (Spec 55 §7/§8.2's own confirmed shape: Branch Staff gets no raw row
    // access, but IS meant to get this endpoint's answer) — running the read under
    // the TARGET Student's own tenant context (which always satisfies Membership's
    // self-read RLS clause) is what actually makes that authorization meaningful,
    // since only the derived ACTIVE/EXPIRED/NONE value below ever leaves this
    // method, never a raw row. Do not change this back to callerId.
    const memberships = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.membership.findMany({
        where: { studentId, schoolId },
        select: { status: true, expiryDate: true, classesRemaining: true },
      }),
    );
    if (memberships.length === 0) return 'NONE';
    const now = new Date();
    const hasActive = memberships.some((m) => isMembershipLive(m, now));
    return hasActive ? 'ACTIVE' : 'EXPIRED';
  }

  /**
   * GET /membership-plans/{id}/active-count (v1.2 backend backlog —
   * MembershipPlansPage's own "Active members" stat tile, shown today as a
   * disabled "—" placeholder). School Owner/Manager only, same gate as
   * findAllPlans/createPlan/updatePlan above — a per-plan membership count is
   * revenue-adjacent aggregate data, the same management-surface sensitivity
   * findAllPlans' own "FOUND ON REVIEW" comment already established, not the
   * Discovery-facing read's visible-only shape.
   *
   * Reuses isMembershipLive() — the ONE established "Active" definition this
   * file already exports and Decision 152 already reuses for the Grading
   * Board's "currently attending" — rather than inventing a second one.
   * Fetch-then-filter-in-JS, the same shape getMembershipStatus() above
   * already uses for the identical "Active means live-computed, not a stored
   * status flag alone" reasoning, just counted across every Membership
   * against this Plan instead of one Student's own.
   */
  async getActiveMemberCount(callerId: string, planId: string): Promise<{ activeCount: number; subscriberCount: number }> {
    const plan = await this.findOnePlan(callerId, planId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);

    const { memberships, studentIds } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { membershipPlanId: planId },
        select: { studentId: true, status: true, expiryDate: true, classesRemaining: true, stripeSubscriptionId: true },
      });
      // Decision 334 (Memberships review M18): a Student removed from the
      // School is no longer counted as a member, whatever their Membership
      // row still says.
      const grants = await tx.roleGrant.findMany({
        where: { schoolId: plan.schoolId, role: 'STUDENT', revokedAt: null, userId: { in: [...new Set(rows.map((r) => r.studentId))] } },
        select: { userId: true },
      });
      return { memberships: rows, studentIds: new Set(grants.map((g) => g.userId)) };
    });
    const now = new Date();
    const live = memberships.filter((m) => studentIds.has(m.studentId) && isMembershipLive(m, now));
    return {
      activeCount: live.length,
      // Decision 334 (Memberships review M9): the people a price change
      // actually reaches. The portal's migrate-or-keep prompt uses this, the
      // same count updatePlan() checks.
      subscriberCount: live.filter((m) => m.stripeSubscriptionId !== null).length,
    };
  }
}
