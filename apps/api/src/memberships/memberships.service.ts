import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
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

// Types a Cash/Bank-eligible MembershipPlan may be — everything except SUBSCRIPTION,
// which requires Stripe (Spec 55 §6.1: "requires Stripe as the payment method when
// type=Subscription... auto-recurring billing has no Cash/Bank Transfer equivalent").
const CASH_BANK_ELIGIBLE_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS', 'TRIAL_MEMBERSHIP'] as const;

/** A membership in effect now: ACTIVE, not past its expiry date (a
 * live-computed predicate, Decision 26), and not a used-up pack. Shared with
 * the Grading Board's "currently attending" (Decision 152). */
export function isMembershipLive(
  m: { status: string; expiryDate: Date | null; classesRemaining: number | null },
  now: Date = new Date(),
): boolean {
  if (m.status !== 'ACTIVE') return false;
  if (m.expiryDate && m.expiryDate < now) return false;
  if (m.classesRemaining !== null && m.classesRemaining <= 0) return false;
  return true;
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
    this.assertValidPlanShape(dto.type, dto.price, dto.classesIncluded, dto.scopedClassId);
    this.assertValidNewMemberBillingStrategy(dto.type, dto.newMemberBillingStrategy ?? 'FRESH_CYCLE', dto.billingCycleAnchorDay);

    if (dto.scopedClassId) {
      const scopedClass = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.class.findUnique({ where: { id: dto.scopedClassId }, select: { id: true, schoolId: true } }),
      );
      if (!scopedClass || scopedClass.schoolId !== schoolId) {
        throw new BadRequestException('scopedClassId must reference a Class belonging to this School');
      }
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
          title: dto.title,
          price: dto.type === 'FRIEND_PASS' ? 0 : dto.price,
          currency: dto.currency,
          expiryDurationDays: dto.expiryDurationDays,
          classesIncluded: this.resolveClassesIncluded(dto.type, dto.classesIncluded, dto.scopedClassId),
          scopedClassId: dto.scopedClassId,
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
    // FOUND ON REVIEW: validate against the FORCED values (0 / 1 for FRIEND_PASS),
    // not the raw incoming ones — an earlier draft validated nextPrice/
    // nextClassesIncluded before forcing, so `PATCH { type: 'FRIEND_PASS' }` alone
    // (price/classesIncluded omitted, carrying forward a non-zero/non-1 existing
    // value) was wrongly rejected as invalid, even though the write below would
    // have forced them correctly. Mirror createPlan's own create-time shape exactly.
    const nextPrice = nextType === 'FRIEND_PASS' ? 0 : dto.price ?? existing.price;
    const nextScopedClassId = dto.scopedClassId !== undefined ? dto.scopedClassId : existing.scopedClassId;
    const nextClassesIncluded = this.resolveClassesIncluded(
      nextType,
      dto.classesIncluded ?? existing.classesIncluded ?? undefined,
      nextScopedClassId ?? undefined,
    );
    this.assertValidPlanShape(nextType, nextPrice, nextClassesIncluded, nextScopedClassId ?? undefined);
    // Decision 259 — validated against the resolved NEXT combination, same
    // discipline as nextType/nextPrice above: a PATCH that only changes type
    // away from SUBSCRIPTION while an existing PRORATED_TO_SHARED_CYCLE/
    // billingCycleAnchorDay combination carries forward unchanged must still
    // be caught, not just a request that touches these two fields directly.
    const nextNewMemberBillingStrategy = dto.newMemberBillingStrategy ?? existing.newMemberBillingStrategy;
    const nextBillingCycleAnchorDay = dto.billingCycleAnchorDay !== undefined ? dto.billingCycleAnchorDay : existing.billingCycleAnchorDay;
    this.assertValidNewMemberBillingStrategy(nextType, nextNewMemberBillingStrategy, nextBillingCycleAnchorDay);

    // FOUND ON REVIEW (Phase 18): `dto.scopedClassId` narrowed via `if
    // (dto.scopedClassId)` doesn't stay narrowed inside the async closure
    // below — a TS property-narrowing limitation across function boundaries,
    // now actually surfaced now that scopedClassId's type includes `| null`
    // (see this DTO's own header comment on why). Hoisted to a local const,
    // which DOES stay narrowed.
    if (dto.disciplineIds) await this.assertStylesOfSchool(callerId, existing.schoolId, dto.disciplineIds);

    const scopedClassIdToValidate = dto.scopedClassId;
    if (scopedClassIdToValidate) {
      const scopedClass = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.class.findUnique({ where: { id: scopedClassIdToValidate }, select: { id: true, schoolId: true } }),
      );
      if (!scopedClass || scopedClass.schoolId !== existing.schoolId) {
        throw new BadRequestException('scopedClassId must reference a Class belonging to this School');
      }
    }

    // Write the already-resolved next* values whenever ANY field that could affect
    // them changed — not `dto.type === 'FRIEND_PASS'` alone (a second instance of
    // the same bug the comment above just fixed on the validation side: a
    // price-only PATCH against an EXISTING FRIEND_PASS plan must still force price
    // back to 0, even though dto.type itself is undefined on that request).
    const priceOrTypeChanged = dto.price !== undefined || dto.type !== undefined;
    const classesIncludedChanged = dto.classesIncluded !== undefined || dto.scopedClassId !== undefined || dto.type !== undefined;

    // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
    // prompt. Only SUBSCRIPTION-staying-SUBSCRIPTION edits are in scope — a
    // type change away from/into SUBSCRIPTION alongside a price change is a
    // separate, pre-existing gap this feature doesn't attempt to also solve
    // (flagged, not silently handled). `priceChanged` is the forced/resolved
    // nextPrice vs. the stored price, not the raw dto.price — same "validate
    // against the forced value" discipline this method's own FRIEND_PASS
    // comment above already established.
    const priceChanged = existing.type === 'SUBSCRIPTION' && nextType === 'SUBSCRIPTION' && priceOrTypeChanged && nextPrice !== existing.price;
    let stripeProductId: string | undefined;
    let stripePriceId: string | undefined;
    let affectedMembershipCount = 0;
    if (priceChanged) {
      affectedMembershipCount = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.membership.count({ where: { membershipPlanId: planId, status: 'ACTIVE', stripeSubscriptionId: { not: null } } }),
      );
      // A brand-new/never-subscribed plan has nothing to migrate or
      // grandfather — no choice is required, and no decision row is created;
      // the price simply changes, same as any other field edit.
      if (affectedMembershipCount > 0) {
        if (!dto.priceChangeStrategy) {
          throw new BadRequestException(
            `This SUBSCRIPTION plan has ${affectedMembershipCount} active subscriber(s) — choose priceChangeStrategy ("MIGRATE" or "GRANDFATHER") before changing its price.`,
          );
        }
        const nextCurrency = dto.currency !== undefined ? dto.currency : existing.currency;
        const connectedAccountId = await this.paymentsService.getStripeConnectedAccountId(callerId, existing.schoolId);
        const created = await this.paymentsService.createPriceForPlan(connectedAccountId, {
          existingProductId: existing.stripeProductId,
          productName: dto.title ?? existing.title,
          amount: nextPrice,
          currency: nextCurrency ?? 'usd',
        });
        stripeProductId = created.productId;
        stripePriceId = created.priceId;
      }
    } else if (dto.priceChangeStrategy) {
      // FOUND ON REVIEW: a strategy sent when nothing actually requires one
      // (price unchanged, or this isn't a SUBSCRIPTION-staying-SUBSCRIPTION
      // edit) is rejected rather than silently ignored — the same "a
      // caller-supplied value with no effect is a caller mistake worth
      // surfacing" discipline this codebase already applies elsewhere (e.g.
      // classesIncluded: null above).
      throw new BadRequestException('priceChangeStrategy was provided but this edit does not change a SUBSCRIPTION plan\'s price — omit it.');
    }

    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membershipPlan.update({
        where: { id: planId },
        data: {
          type: dto.type,
          title: dto.title,
          price: priceOrTypeChanged ? nextPrice : undefined,
          currency: dto.currency,
          expiryDurationDays: dto.expiryDurationDays,
          classesIncluded: classesIncludedChanged ? nextClassesIncluded : undefined,
          scopedClassId: dto.scopedClassId,
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
    // nothing would ever set giftedById. Rather than build a guess at what a real
    // staff-gifting endpoint/flow looks like (its own confirmed shape isn't given
    // anywhere in Spec 55's §7 endpoint table — genuinely out of scope, not a
    // detail to invent per CLAUDE.md's "never invent unspecified business logic"),
    // block it here explicitly so the gap is loud, not silently wrong. Applies
    // identically to a Guardian-driven attempt — a Guardian buying a Friend Pass
    // FOR a minor is the same self-grant workaround under a different caller.
    if (plan.type === 'FRIEND_PASS') {
      throw new BadRequestException('FRIEND_PASS Memberships are School-gifted, not self-purchased — no staff-gifting endpoint exists yet (out of scope this phase).');
    }
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
    const currency = plan.currency ?? 'usd';

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
        );
        await this.prismaApp.withTenantContext(studentId, (tx) =>
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
        return { outcome: 'requires_payment' as const, clientSecret, transactionId };
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

      const { paymentIntentId, clientSecret } = await this.paymentsService.charge(studentId, plan.schoolId, plan.price, currency, plan.title);
      await this.prismaApp.withTenantContext(studentId, (tx) =>
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
      return { outcome: 'requires_payment' as const, clientSecret, transactionId };
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
        throw new ConflictException('This Student already holds an active general-access Membership at this School — your saved card was charged and has now been refunded.');
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
    );
    const transactionId = randomUUID();
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
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: paymentIntentId,
        },
      }),
    );
    return { outcome: 'requires_checkout' as const, checkoutUrl, transactionId };
  }

  /**
   * Atomicity requirement (Spec 55 §11.5): a Student may not hold two simultaneous
   * Active general-access (Subscription/Weekly Pass) Memberships at the same School.
   * Enforced via a partial unique index at the DB level (see this phase's migration)
   * rather than a separate findFirst-then-create check — the same atomic
   * create()+caught-unique-violation shape this codebase already established for
   * ProcessedStripeEvent's dedup, not a TOCTOU-prone check-then-insert.
   */
  async createMembershipAndReturn(studentId: string, plan: { id: string; schoolId: string; type: string; classesIncluded: number | null; expiryDurationDays: number | null; scopedClassId: string | null }, stripeSubscriptionId: string | null) {
    try {
      const membership = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.membership.create({
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
        }),
      );
      return { outcome: 'active' as const, membership };
    } catch (err) {
      // See this phase's migration for the partial unique index this relies on —
      // P2002 here means the Student already holds an Active general-access
      // Membership at this School.
      if (this.isUniqueConstraintViolation(err)) {
        throw new ConflictException('This Student already holds an active general-access Membership at this School.');
      }
      throw err;
    }
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
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
  async getActiveMemberCount(callerId: string, planId: string): Promise<number> {
    const plan = await this.findOnePlan(callerId, planId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);

    const memberships = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membership.findMany({
        where: { membershipPlanId: planId },
        select: { status: true, expiryDate: true, classesRemaining: true },
      }),
    );
    const now = new Date();
    return memberships.filter((m) => isMembershipLive(m, now)).length;
  }
}
