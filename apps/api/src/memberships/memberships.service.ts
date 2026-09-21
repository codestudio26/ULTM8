import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { PaymentsService } from '../payments/payments.service';
import { GuardiansService } from '../guardians/guardians.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import { PurchaseMembershipDto } from './dto/purchase-membership.dto';

// Types a Cash/Bank-eligible MembershipPlan may be — everything except SUBSCRIPTION,
// which requires Stripe (Spec 55 §6.1: "requires Stripe as the payment method when
// type=Subscription... auto-recurring billing has no Cash/Bank Transfer equivalent").
const CASH_BANK_ELIGIBLE_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS', 'TRIAL_MEMBERSHIP'] as const;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly paymentsService: PaymentsService,
    private readonly guardiansService: GuardiansService,
    private readonly subscriptionGate: SubscriptionGateService,
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

    if (dto.scopedClassId) {
      const scopedClass = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.class.findUnique({ where: { id: dto.scopedClassId }, select: { id: true, schoolId: true } }),
      );
      if (!scopedClass || scopedClass.schoolId !== schoolId) {
        throw new BadRequestException('scopedClassId must reference a Class belonging to this School');
      }
    }

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
        },
      }),
    );
  }

  async findAllPlans(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId);
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

    // FOUND ON REVIEW (Phase 18): `dto.scopedClassId` narrowed via `if
    // (dto.scopedClassId)` doesn't stay narrowed inside the async closure
    // below — a TS property-narrowing limitation across function boundaries,
    // now actually surfaced now that scopedClassId's type includes `| null`
    // (see this DTO's own header comment on why). Hoisted to a local const,
    // which DOES stay narrowed.
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
    return this.prismaApp.withTenantContext(callerId, (tx) =>
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
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired,
        },
      }),
    );
  }

  // No delete method — same reasoning ClassesModule/School/Branch already
  // established (general tenant offboarding is [UNRESOLVED]).

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
  async purchase(callerId: string, planId: string, dto?: PurchaseMembershipDto) {
    const studentId = dto?.studentId ?? callerId;
    const isGuardianAction = dto?.studentId !== undefined && dto.studentId !== callerId;
    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    }

    const plan = await this.findOnePlan(studentId, planId);
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
      tx.user.findUniqueOrThrow({ where: { id: studentId }, select: { email: true } }),
    );
    const currency = plan.currency ?? 'usd';

    if (paymentAccount.provider === 'STRIPE') {
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
              currency,
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
            currency,
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
    const transactionId = randomUUID();
    await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.transaction.create({
        data: {
          id: transactionId,
          schoolId: plan.schoolId,
          studentId,
          paymentAccountId: paymentAccount.id,
          membershipPlanId: plan.id,
          amount: plan.price,
          currency,
          status: 'PENDING',
          paymentMethod: paymentAccount.provider,
        },
      }),
    );
    return { outcome: 'pending_confirmation' as const, transactionId };
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
    const hasActive = memberships.some((m) => {
      if (m.status !== 'ACTIVE') return false;
      if (m.expiryDate && m.expiryDate < now) return false; // live-computed predicate (Decision 26)
      if (m.classesRemaining !== null && m.classesRemaining <= 0) return false;
      return true;
    });
    return hasActive ? 'ACTIVE' : 'EXPIRED';
  }
}
