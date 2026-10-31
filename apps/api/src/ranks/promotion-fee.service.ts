import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, PromotionFeeRequest, PromotionFeeStatus } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { RequestContext } from '../common/request-context';
import { cursorPaginate } from '../common/pagination/cursor-paginate';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { dayIn, dayToDate } from '../memberships/freeze/membership-freeze';
import { insertCharge, lockInvoiceNumbers } from '../charges/charge-insert';
import { cancelChargeInTx, chargeCancelledNotice } from '../charges/charge-cancel';
import { chargePaid, chargeRemaining, lockBalance } from '../charges/charge-ledger';
import { computeCharge, formatInvoiceNumber } from '../charges/charge-maths';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { GradingService } from './grading.service';
import { loadLadder } from './grading-attendance';
import { rungIndex } from './engine/ladder';
import { isOpenToDecide, isPromotionBlocked, isWaitingForFee, PendingGrade } from './promotion-fee';
import { PromotionFeeRequestQueryDto, UpdatePromotionFeeSettingsDto } from './dto/promotion-fee.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FeeCharge = Prisma.ChargeGetPayload<{ include: { allocations: { select: { amount: true } } } }>;

/** What a charge has had put toward it, and what it still owes: total −
 * refunded − paid (step 4), as everywhere else on the ledger. */
const paidOn = (c: FeeCharge) => chargePaid(c);
const owedOn = (c: FeeCharge) => (c.cancelledAt ? 0 : Math.max(0, chargeRemaining(c)));

/** Money as the API's English notices write it ("120.00 BRL"), as ChargesService does. */
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** Statuses the owner may still waive or cancel ("at any time", Decision 307). */
const OPEN_FOR_OWNER: PromotionFeeStatus[] = ['PENDING', 'ACCEPTED', 'DECLINED'];

/**
 * Promotion fee (Decisions 287, 297, 300, 303, 307, 313): the School-wide
 * switches, the requests, and what the payer and the owner do with them. The
 * fee itself is made when a coach grades (GradingService.changeRung).
 *
 * Who does what:
 * - The switches and the prices: the School owner only (Decision 297).
 * - Accept / decline: the payer — the student, or an active Guardian of the
 *   student (Decision 300 item 5), checked as for every other on-behalf
 *   action (GuardiansService.assertGuardianOfStudent).
 * - Waive / cancel: the School owner only (Decisions 300, 307 name only the
 *   owner).
 * - Dismiss a "to decide": the owner, or a coach who may promote that student
 *   in that style (Decision 307 item 3). The decisions say a coach decides
 *   "or decides not to" (Decision 313 item 1) but name no action for it; this
 *   endpoint is the narrowest one. Needs product-owner confirmation.
 * - Paying (backlog §3.6 step 6; Decision 303 item 5): accepting makes a
 *   Charge for the fee on the student's balance, paid like any charge (at the
 *   desk, in the app, automatically with a saved card, or by credit). When it
 *   is fully paid, settlePaidCharges() marks the request PAID through
 *   markPaid(), which applies a waiting promotion. Waiving or cancelling the
 *   fee cancels its charge. There is still no endpoint that marks a fee paid.
 * - A fee paid in full whose waiting promotion can no longer apply (the
 *   student's rank or the ladder changed since the grade; Decision 414 item
 *   1): recorded once (promotionBlockedAt), the owner(s) told once, and the
 *   request left Accepted with its money paid until the owner cancels the fee
 *   (cancel(): the money becomes credit) or the student is graded again
 *   (GradingService cancels it the same way, so the money is credit toward
 *   the new grade; Decision 415 item 1). Nothing happens to the money until then.
 *
 * Writes run under the student's own context, like every grading write
 * (Decision 88): the request's RLS lets the student's context write it, and
 * only after the checks above. The charge itself is written on the jobs
 * connection, as every Charge is.
 */
@Injectable()
export class PromotionFeeService {
  private readonly logger = new Logger(PromotionFeeService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
    private readonly gradingService: GradingService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // The switches
  // ---------------------------------------------------------------------------

  /** Readable by the School's staff (the owner included), so the portal knows
   * whether to show prices and fee states. */
  async getSettings(callerId: string, schoolId: string) {
    this.assertUuid(schoolId, 'schoolId');
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return this.readSettings(callerId, schoolId);
  }

  /** Owner only (Decision 297); anyone else gets 403. */
  async updateSettings(callerId: string, schoolId: string, dto: UpdatePromotionFeeSettingsDto) {
    this.assertUuid(schoolId, 'schoolId');
    if (dto.promotionFeeEnabled === undefined && dto.gradeBeforeFeePaid === undefined) {
      throw new BadRequestException('Send promotionFeeEnabled, gradeBeforeFeePaid, or both.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          ...(dto.promotionFeeEnabled !== undefined ? { promotionFeeEnabled: dto.promotionFeeEnabled } : {}),
          ...(dto.gradeBeforeFeePaid !== undefined ? { promotionFeeGradeBeforePaid: dto.gradeBeforeFeePaid } : {}),
        },
      }),
    );
    return this.readSettings(callerId, schoolId);
  }

  private async readSettings(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { promotionFeeEnabled: true, promotionFeeGradeBeforePaid: true, defaultCurrency: true } }),
    );
    if (!school) throw new NotFoundException('School not found');
    return { promotionFeeEnabled: school.promotionFeeEnabled, gradeBeforeFeePaid: school.promotionFeeGradeBeforePaid, currency: school.defaultCurrency };
  }

  // ---------------------------------------------------------------------------
  // Lists
  // ---------------------------------------------------------------------------

  /** A School's requests, newest first. The owner sees all; other staff see
   * those of the students they cover on the Grading Board (the request's RLS,
   * Decisions 168, 169). */
  async listForSchool(callerId: string, schoolId: string, query: PromotionFeeRequestQueryDto, cursor?: string, limit?: number) {
    this.assertUuid(schoolId, 'schoolId');
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    // Amounts are prices (Decision 314 item 1): the owner sees every style;
    // anyone else only the styles they have grading permission for.
    const styles = await this.gradingStylesOf(callerId, schoolId);
    if (styles && styles.length === 0) {
      throw new ForbiddenException('You do not have grading permission at this School. The School owner grants it.');
    }
    if (styles && query.disciplineId && !styles.includes(query.disciplineId)) return { items: [], nextCursor: null };
    // A move from a Kids style into its Adult program (Decision 419 item 2)
    // concerns both styles: the one graded from and the one moved into.
    const inStyles = (ids: string[]) => ({ OR: [{ disciplineId: { in: ids } }, { toDisciplineId: { in: ids } }] });
    const disciplineFilter = query.disciplineId ? inStyles([query.disciplineId]) : styles ? inStyles(styles) : {};
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.promotionFeeRequest.findMany({
            ...args,
            where: {
              schoolId,
              ...(query.status ? { status: query.status } : {}),
              ...(query.studentId ? { studentId: query.studentId } : {}),
              ...disciplineFilter,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
        cursor,
        limit,
      ),
    );
    return { items: await this.shapeWithCharges(page.items), nextCursor: page.nextCursor };
  }

  /** null for the School owner (every style); otherwise the styles the caller
   * has grading permission for at this School. */
  private async gradingStylesOf(callerId: string, schoolId: string): Promise<string[] | null> {
    try {
      await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
      return null;
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }
    const permissions = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.gradingPermission.findMany({ where: { userId: callerId, schoolId }, select: { disciplineId: true } }),
    );
    return permissions.map((p) => p.disciplineId);
  }

  /** The student app (Decision 300 item 2): a student's own requests at every
   * School, for the student or their Guardian. Read under the student's own
   * context, as the app's other grading reads (a Guardian holds no role at
   * the School). */
  async listForStudent(callerId: string, studentId: string) {
    await this.assertPayer(callerId, studentId);
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    const rows = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.promotionFeeRequest.findMany({
        where: { studentId, ...(impersonationSchoolId ? { schoolId: impersonationSchoolId } : {}) },
        include: { school: { select: { name: true } }, discipline: { select: { name: true } }, toDiscipline: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    );
    // shape() picks its own fields, so the joined names don't leak into it.
    const shaped = await this.shapeWithCharges(rows);
    return {
      items: rows.map((r, i) => ({
        ...shaped[i],
        schoolName: r.school.name,
        disciplineName: r.discipline.name,
        ...(r.toDiscipline ? { toDisciplineName: r.toDiscipline.name } : {}),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // The payer: accept or decline (Decision 300 items 2, 3, 5)
  // ---------------------------------------------------------------------------

  /**
   * Accepting moves the request to ACCEPTED and makes its charge (backlog
   * §3.6 step 6; Decision 303 item 5): on the student's balance, for the rank
   * it is for, due today, with the School's tax (Decision 411), and paid at
   * once by any credit the student has. A waiting promotion still waits until
   * the charge is fully paid. A School with no currency can't take the fee,
   * so the request isn't accepted at all.
   */
  async accept(callerId: string, requestId: string) {
    const request = await this.find(callerId, requestId);
    await this.assertPayer(callerId, request.studentId);
    const school = await this.prismaJobs.school.findUnique({ where: { id: request.schoolId }, select: { defaultCurrency: true } });
    if (!request.currency && !school?.defaultCurrency) {
      throw new BadRequestException({
        code: 'PROMOTION_FEE_NO_CURRENCY',
        message: "This School hasn't set its currency yet, so the fee can't be paid. Ask the School.",
      });
    }
    await this.answer(callerId, requestId, 'ACCEPTED');
    try {
      await this.ensureCharge(requestId);
      await this.settlePaidCharges(request.schoolId, request.studentId);
    } catch (err) {
      // Accepted all the same; the daily catch-up (reconcile) makes the charge.
      this.logger.error(`Promotion fee ${requestId} was accepted but its charge could not be made now; the daily catch-up retries.`, err as Error);
    }
    return this.reread(request.studentId, request.id);
  }

  /** Declining: a promotion that applied stays; a waiting one never applies
   * on its own. The owner sees "Fee declined" (Decision 300 item 3). */
  async decline(callerId: string, requestId: string) {
    return this.answer(callerId, requestId, 'DECLINED');
  }

  /** Only an unanswered request can be answered. Declining after accepting is
   * refused: the decisions don't say the payer can change their answer, so
   * this is the narrowest reading. Needs product-owner confirmation. */
  private async answer(callerId: string, requestId: string, to: 'ACCEPTED' | 'DECLINED') {
    const request = await this.find(callerId, requestId);
    await this.assertPayer(callerId, request.studentId);
    await this.tenantAuth.assertSchoolNotArchived(request.studentId, request.schoolId);
    const now = new Date();
    const updated = await this.prismaApp.withTenantContext(request.studentId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: to, respondedById: callerId, ...(to === 'ACCEPTED' ? { acceptedAt: now } : { declinedAt: now }) },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This fee has already been answered, waived or cancelled.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // The owner: waive or cancel at any time (Decisions 300 item 3, 307)
  // ---------------------------------------------------------------------------

  /**
   * - A promotion waiting for its fee: applied now, as the coach made it, with
   *   their grading date (Decision 307 item 4).
   * - A fee the payer declined on a promotion that never applied: nothing is
   *   applied; the promotion is "to decide" for a coach (Decision 307 item 3).
   * - A promotion that already applied: the fee is simply waived.
   */
  async waive(callerId: string, requestId: string) {
    const request = await this.findForOwner(callerId, requestId);
    // Paid, with a promotion that can't apply: the owner's two choices are
    // cancelling the fee or grading again (Decision 414 item 1), not waiving.
    if (isPromotionBlocked(request)) {
      throw new ConflictException('This fee is paid, but its promotion can no longer apply. Cancel the fee (what was paid becomes credit), or grade the student again.');
    }
    if (isWaitingForFee(request)) {
      await this.gradingService.applyWaitingPromotion(callerId, request, 'WAIVED', callerId);
    } else {
      await this.close(callerId, request, 'WAIVED');
    }
    // Step 6: nothing is owed for a waived fee; anything paid is credit.
    await this.cancelOpenCharge(request.id, callerId);
    return this.reread(request.studentId, request.id);
  }

  /**
   * Cancelling never promotes (Decision 307 item 3): a promotion that never
   * applied (waiting, or declined) is left "to decide" for a coach. A
   * promotion that already applied ("grade before paid" on) stays: the
   * decisions don't say a cancelled fee undoes it, and undoing it would be a
   * downgrade nobody chose. Cancelling a declined fee is treated like waiving
   * one ("to decide"). Both readings need product-owner confirmation.
   * A paid fee whose promotion can no longer apply (Decision 414 item 1) is
   * cancelled the same way: its charge is cancelled and what was paid becomes
   * credit. It isn't left "to decide": the promotion can't apply as made, and
   * the owner who cancels it is the one who decides whether to grade again.
   */
  async cancel(callerId: string, requestId: string) {
    const request = await this.findForOwner(callerId, requestId);
    await this.close(callerId, request, 'CANCELLED');
    // Step 6: nothing is owed for a cancelled fee; anything paid is credit.
    await this.cancelOpenCharge(request.id, callerId);
    return this.reread(request.studentId, request.id);
  }

  private async close(callerId: string, request: PromotionFeeRequest, to: 'WAIVED' | 'CANCELLED') {
    if (!OPEN_FOR_OWNER.includes(request.status)) {
      throw new ConflictException(`This fee is already ${request.status.toLowerCase()}.`);
    }
    const now = new Date();
    // A paid fee whose promotion can't apply goes to no coach (see cancel()).
    const neverApplied = request.promotionWaits && request.promotionEventId === null && request.promotionBlockedAt === null;
    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, status: request.status, promotionEventId: request.promotionEventId, toDecideAt: null },
        data: {
          status: to,
          closedById: callerId,
          ...(to === 'WAIVED' ? { waivedAt: now } : { cancelledAt: now }),
          // The planned promotion goes to a coach (Decision 307); the reminder clock starts (Decision 313).
          ...(neverApplied ? { toDecideAt: now } : {}),
        },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This fee request was changed at the same time — reload and try again.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // "To decide": a coach decides not to promote (Decisions 307, 313)
  // ---------------------------------------------------------------------------

  /** The owner, or anyone with grading permission for this style who covers
   * the student (Decision 314 item 2). Promoting is the normal Promote,
   * fee-free (GradingService). */
  async dismiss(callerId: string, requestId: string) {
    const request = await this.find(callerId, requestId);
    if (!isOpenToDecide(request)) {
      throw new ConflictException('This promotion is not waiting for a decision.');
    }
    await this.gradingService.assertHasGradingAccess(callerId, request.schoolId, request.disciplineId, request.studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, request.schoolId);
    const updated = await this.prismaApp.withTenantContext(request.studentId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, toDecideAt: { not: null }, toDecideResolvedAt: null },
        data: { toDecideResolvedAt: new Date(), toDecideResolution: 'DISMISSED', toDecideResolvedById: callerId },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This promotion was decided at the same time — reload to see what happened.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // Payment (Decision 303) — internal only
  // ---------------------------------------------------------------------------

  /**
   * An accepted fee has been paid: its charge is fully paid (called by
   * settlePaidCharges(), never by an endpoint). A promotion that waited for
   * this fee applies now, with the coach's grading date, once only
   * (GradingService.applyWaitingPromotion); otherwise the request is just
   * marked paid.
   */
  async markPaid(studentId: string, requestId: string) {
    const request = await this.prismaApp.withTenantContext(studentId, (tx) => tx.promotionFeeRequest.findFirst({ where: { id: requestId, studentId } }));
    if (!request) throw new NotFoundException('Fee request not found');
    if (request.status !== 'ACCEPTED') {
      throw new ConflictException('Only an accepted fee can be paid.');
    }
    if (isWaitingForFee(request)) {
      await this.gradingService.applyWaitingPromotion(studentId, request, 'PAID');
    } else {
      const updated = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.promotionFeeRequest.updateMany({ where: { id: request.id, status: 'ACCEPTED' }, data: { status: 'PAID', paidAt: new Date() } }),
      );
      if (updated.count === 0) throw new ConflictException('This fee request was changed at the same time.');
    }
    return this.reread(studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // The fee's charge (backlog §3.6 step 6; Decision 303 item 5)
  // ---------------------------------------------------------------------------

  /**
   * Makes the charge of an accepted fee, once (Charge.promotionFeeRequestId
   * is unique). Through the shared insertCharge(), as every charge: the next
   * invoice number, the School's tax settings today (Decision 411; the
   * decisions on the fee say nothing different, so the price is treated as
   * any price the School sets: tax included or added, as the School chose),
   * due today in the School's time zone, and any credit on the balance put on
   * it at once (Decision 303 item 2). The description is the rank it is for.
   * The member gets the usual "New invoice" notice. Nothing is made unless
   * the request is still ACCEPTED, read under a share lock so a waive or
   * cancel at the same moment either comes first (no charge) or waits for this
   * one (and then cancels it).
   */
  private async ensureCharge(requestId: string): Promise<void> {
    const request = await this.prismaJobs.promotionFeeRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== 'ACCEPTED') return;
    if (await this.prismaJobs.charge.findUnique({ where: { promotionFeeRequestId: requestId }, select: { id: true } })) return;
    const school = await this.prismaJobs.school.findUnique({
      where: { id: request.schoolId },
      select: { defaultCurrency: true, timezone: true, taxCountry: true, taxRateBasisPoints: true, taxInclusive: true },
    });
    const currency = (request.currency ?? school?.defaultCurrency)?.toUpperCase();
    if (!school || !currency) return;
    const totals = computeCharge({ unitAmount: request.amountMinor, discount: null, taxRateBasisPoints: school.taxRateBasisPoints, taxInclusive: school.taxInclusive });

    let created: { id: string; invoiceNumber: number } | null;
    try {
      created = await this.prismaJobs.$transaction(async (tx) => {
        await lockSchoolOpen(tx, request.schoolId);
        await lockInvoiceNumbers(tx, request.schoolId);
        await lockBalance(tx, request.schoolId, request.studentId);
        const [row] = await tx.$queryRaw<{ status: PromotionFeeStatus }[]>`SELECT "status" FROM "PromotionFeeRequest" WHERE "id" = ${requestId} FOR SHARE`;
        if (row?.status !== 'ACCEPTED') return null;
        return insertCharge(tx, {
          schoolId: request.schoolId,
          studentId: request.studentId,
          description: request.toRungName,
          unitAmount: request.amountMinor,
          discountType: null,
          discountValue: null,
          taxCountry: school.taxCountry,
          taxRateBasisPoints: school.taxRateBasisPoints,
          taxInclusive: school.taxInclusive,
          totals,
          currency,
          dueDate: dayToDate(dayIn(new Date(), school.timezone)),
          createdById: null,
          promotionFeeRequestId: requestId,
        });
      });
    } catch (err) {
      // Made at the same moment by another path (an accept and the catch-up).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      throw err;
    }
    if (!created) return;
    const due = dayIn(new Date(), school.timezone);
    await this.notify(request.studentId, request.schoolId, `charge-created-${created.id}`, {
      title: 'New invoice',
      body: `Invoice ${formatInvoiceNumber(created.invoiceNumber)} for ${request.toRungName}: ${money(totals.grossAmount, currency)}, due ${due}.`,
      targetId: created.id,
    });
  }

  /**
   * Cancels the open charge of a fee that was waived or cancelled, through the
   * same ledger write as cancelling any charge (Decision 338 item 1): the
   * charge stays as a record, marked Cancelled, and anything already paid on it
   * is credit, put toward the member's next open charge. The member gets the
   * usual "Charge cancelled" notice. Nothing to do when there is no charge
   * (never accepted) or it is already cancelled. The ledger write is not
   * refused for a School closed meanwhile: it only takes a debt away.
   */
  private async cancelOpenCharge(requestId: string, closedById: string | null): Promise<void> {
    const charge = await this.prismaJobs.charge.findUnique({ where: { promotionFeeRequestId: requestId }, select: { id: true, schoolId: true, studentId: true, cancelledAt: true } });
    if (!charge || charge.cancelledAt) return;
    const cancelled = await this.prismaJobs.$transaction(async (tx) => {
      await lockBalance(tx, charge.schoolId, charge.studentId);
      return cancelChargeInTx(tx, { schoolId: charge.schoolId, chargeId: charge.id, cancelledById: closedById, reason: null });
    });
    if (!cancelled) return;
    const notice = chargeCancelledNotice(cancelled.charge.description, cancelled.charge.grossAmount, cancelled.charge.currency, cancelled.paid);
    await this.notify(charge.studentId, charge.schoolId, `charge-cancelled-${charge.id}`, { ...notice, targetId: charge.id });
    // The credit it freed may have paid another promotion fee in full.
    await this.settlePaidCharges(charge.schoolId, charge.studentId);
  }

  /**
   * The ledger's "a charge became fully paid" step for promotion fees, called
   * after every change that can pay a charge: a desk payment and a cancelled
   * charge's freed credit (ChargesService), a card payment in the app (the
   * Stripe webhook), automatic payment (charge-auto-pay), and accepting (credit
   * already on the balance). Each fully paid, not cancelled promotion fee
   * charge whose request is still ACCEPTED goes through markPaid(): PAID, and a
   * waiting promotion applies, once. Safe to call any number of times; the
   * daily catch-up (reconcile) calls it too, so a step lost to a crash after
   * the payment committed is made up. Never throws: the payment already stands.
   */
  async settlePaidCharges(schoolId: string, studentId: string): Promise<void> {
    try {
      const charges = await this.prismaJobs.charge.findMany({
        // One already put to the owner (promotionBlockedAt) waits for them.
        where: { schoolId, studentId, cancelledAt: null, promotionFeeRequest: { status: 'ACCEPTED', promotionBlockedAt: null } },
        include: { allocations: { select: { amount: true } } },
      });
      for (const c of charges) {
        if (owedOn(c) > 0 || !c.promotionFeeRequestId) continue;
        try {
          await this.markPaid(studentId, c.promotionFeeRequestId);
        } catch (err) {
          // The student's rank or the ladder changed since the grade, so the
          // waiting promotion can't apply as it was (GradingService refuses
          // it): put to the owner, once (Decision 414 item 1). Anything else
          // (a passing failure) is retried by the next call or the daily catch-up.
          if (await this.flagIfCannotApply(studentId, c.promotionFeeRequestId)) continue;
          this.logger.error(`Promotion fee ${c.promotionFeeRequestId}: its charge is paid but marking it paid failed.`, err as Error);
        }
      }
    } catch (err) {
      this.logger.error(`Settling promotion fee charges for student ${studentId} at School ${schoolId} failed; the daily catch-up retries.`, err as Error);
    }
  }

  /**
   * The daily catch-up, run by the charge-auto-pay job before it pays
   * anything. Brings every promotion fee and its charge into line:
   * 1. an ACCEPTED request with no charge gets one: requests accepted before
   *    charges existed (the one-time backfill of step 6), or an accept whose
   *    charge failed to be made;
   * 2. a fully paid charge whose request is still ACCEPTED is settled
   *    (settlePaidCharges);
   * 3. a WAIVED or CANCELLED request whose charge is still open has it
   *    cancelled (a waive or cancel whose second step was lost).
   * Each request on its own, so one failure never stops the rest.
   */
  async reconcile(): Promise<{ created: number; settled: number; cancelled: number }> {
    const out = { created: 0, settled: 0, cancelled: 0 };
    const missing = await this.prismaJobs.promotionFeeRequest.findMany({ where: { status: 'ACCEPTED', charge: { is: null } }, select: { id: true, schoolId: true, studentId: true } });
    for (const r of missing) {
      try {
        await this.ensureCharge(r.id);
        if (await this.prismaJobs.charge.findUnique({ where: { promotionFeeRequestId: r.id }, select: { id: true } })) out.created++;
      } catch (err) {
        this.logger.error(`Promotion fee ${r.id}: making its charge failed; tried again on the next run.`, err as Error);
      }
    }
    const accepted = await this.prismaJobs.charge.findMany({
      where: { cancelledAt: null, promotionFeeRequest: { status: 'ACCEPTED', promotionBlockedAt: null } },
      distinct: ['schoolId', 'studentId'],
      select: { schoolId: true, studentId: true },
    });
    for (const s of accepted) {
      const before = await this.prismaJobs.promotionFeeRequest.count({ where: { schoolId: s.schoolId, studentId: s.studentId, status: 'PAID' } });
      await this.settlePaidCharges(s.schoolId, s.studentId);
      out.settled += (await this.prismaJobs.promotionFeeRequest.count({ where: { schoolId: s.schoolId, studentId: s.studentId, status: 'PAID' } })) - before;
    }
    const stale = await this.prismaJobs.charge.findMany({
      where: { cancelledAt: null, promotionFeeRequest: { status: { in: ['WAIVED', 'CANCELLED'] } } },
      select: { promotionFeeRequestId: true, promotionFeeRequest: { select: { closedById: true } } },
    });
    for (const c of stale) {
      try {
        await this.cancelOpenCharge(c.promotionFeeRequestId!, c.promotionFeeRequest?.closedById ?? null);
        out.cancelled++;
      } catch (err) {
        this.logger.error(`Promotion fee ${c.promotionFeeRequestId}: cancelling its charge failed; tried again on the next run.`, err as Error);
      }
    }
    return out;
  }

  /**
   * The charges, still open, of this student's fees that are waived or
   * cancelled, cancelled now through the same ledger write as any cancel
   * (cancelOpenCharge: anything paid becomes credit, the usual "Charge
   * cancelled" notice, then settlePaidCharges). Called by GradingService after
   * a grade up that cancelled a paid fee whose promotion couldn't apply, so
   * what was paid counts toward the new grade (Decision 415 item 1); the daily
   * catch-up (reconcile, step 3) does the same for every School.
   */
  async cancelChargesOfClosedFees(schoolId: string, studentId: string): Promise<void> {
    const open = await this.prismaJobs.charge.findMany({
      where: { schoolId, studentId, cancelledAt: null, promotionFeeRequest: { status: { in: ['WAIVED', 'CANCELLED'] } } },
      select: { promotionFeeRequestId: true, promotionFeeRequest: { select: { closedById: true } } },
    });
    for (const c of open) await this.cancelOpenCharge(c.promotionFeeRequestId!, c.promotionFeeRequest?.closedById ?? null);
  }

  /**
   * A paid fee whose waiting promotion was refused: is that because it can
   * no longer apply as made (Decision 414 item 1: "the student's rank or the
   * belt ladder changed after the grade")? Checked against the data, not the
   * refusal's wording, so a passing failure is never mistaken for it:
   * - the student is no longer on the rung the grade was made from (or has
   *   no rank in the style any more);
   * - that rung, or the rung the grade was to, is no longer on the ladder, or
   *   the grade no longer lands on the same rung (a stripe award moves to the
   *   next stripe of the same belt).
   * If so, the request is marked once (promotionBlockedAt, only while it is
   * still Accepted and unapplied) and the owner(s) told once. Returns true
   * when the request is (now or already) in that state.
   */
  private async flagIfCannotApply(studentId: string, requestId: string): Promise<boolean> {
    try {
      const request = await this.prismaJobs.promotionFeeRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== 'ACCEPTED' || request.promotionEventId !== null || !request.promotionWaits) return false;
      if (request.promotionBlockedAt) return true;
      if (!(await this.cannotApplyAsMade(request))) return false;
      const flagged = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.promotionFeeRequest.updateMany({
          where: { id: request.id, status: 'ACCEPTED', promotionEventId: null, promotionBlockedAt: null },
          data: { promotionBlockedAt: new Date() },
        }),
      );
      if (flagged.count === 1) await this.notifyOwnersBlocked(request);
      return true;
    } catch (err) {
      this.logger.error(`Promotion fee ${requestId}: checking whether its promotion can still apply failed; tried again on the next run.`, err as Error);
      return false;
    }
  }

  private async cannotApplyAsMade(request: PromotionFeeRequest): Promise<boolean> {
    const pg = request.pendingGrade as unknown as PendingGrade | null;
    if (!pg) return false;
    const sr = await this.prismaJobs.studentRank.findUnique({
      where: { studentId_disciplineId: { studentId: request.studentId, disciplineId: request.disciplineId } },
      select: { currentStripeId: true },
    });
    if (!sr || sr.currentStripeId !== pg.expectedCurrentRungId) return true;
    if (pg.type === 'MOVE_TO_ADULT') return this.moveCannotApplyAsMade(request, pg);
    const ladder = await loadLadder(this.prismaJobs, request.disciplineId);
    const from = pg.expectedCurrentRungId ? rungIndex(ladder, pg.expectedCurrentRungId) : -1;
    if (from < 0) return true;
    const to = pg.type === 'STRIPE_AWARD' ? from + 1 : rungIndex(ladder, pg.targetRungId);
    if (to <= from || ladder[to]?.id !== request.toRungId) return true;
    return pg.type === 'STRIPE_AWARD' && ladder[to].rankId !== ladder[from].rankId;
  }

  /** A move into the Adult program (Decision 419 item 2), the student still
   * on the Kids rung it was made from: it can't apply as made when the Kids
   * style is no longer linked to that Adult style, the student already has an
   * Adult rank, the Kids rung is gone, or the Adult rank it was for is no
   * longer above the Adult ladder's first belt. */
  private async moveCannotApplyAsMade(request: PromotionFeeRequest, pg: PendingGrade): Promise<boolean> {
    const kids = await this.prismaJobs.discipline.findUnique({ where: { id: request.disciplineId }, select: { adultDisciplineId: true } });
    if (!request.toDisciplineId || kids?.adultDisciplineId !== request.toDisciplineId) return true;
    const adultRank = await this.prismaJobs.studentRank.findUnique({
      where: { studentId_disciplineId: { studentId: request.studentId, disciplineId: request.toDisciplineId } },
      select: { id: true },
    });
    if (adultRank) return true;
    if (!pg.expectedCurrentRungId || rungIndex(await loadLadder(this.prismaJobs, request.disciplineId), pg.expectedCurrentRungId) < 0) return true;
    const adultLadder = await loadLadder(this.prismaJobs, request.toDisciplineId);
    const to = rungIndex(adultLadder, pg.targetRungId);
    return to < 0 || adultLadder[to].id !== request.toRungId || adultLadder[to].rankId === adultLadder[0].rankId;
  }

  /** The School's owner(s) are told, once per owner (the notice id is the
   * request's and the owner's), in the app's Notifications, opening grading
   * (Decision 414 item 1). Best-effort, as every notice: the portal shows
   * the state on the student's grading card either way. */
  private async notifyOwnersBlocked(request: PromotionFeeRequest): Promise<void> {
    try {
      const [owners, student, discipline] = await Promise.all([
        this.prismaJobs.roleGrant.findMany({ where: { schoolId: request.schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { userId: true }, distinct: ['userId'] }),
        this.prismaJobs.user.findUnique({ where: { id: request.studentId }, select: { firstName: true, surname: true } }),
        // The style of the rank the fee is for (the Adult style for a move into it).
        this.prismaJobs.discipline.findUnique({ where: { id: request.toDisciplineId ?? request.disciplineId }, select: { name: true } }),
      ]);
      const name = student ? `${student.firstName} ${student.surname}`.trim() : 'A student';
      for (const { userId } of owners) {
        const key = `promotion-fee-blocked-${request.id}-${userId}`;
        await this.fanoutQueue.add(
          'notify',
          {
            notificationId: key,
            userId,
            title: "Promotion can't apply",
            body: `${name}'s fee for ${request.toRungName} (${discipline?.name ?? 'grading'}) is paid, but the promotion can't apply: their rank or the belt ladder changed since the grade. Cancel the fee (what was paid becomes credit) or grade them again.`,
            type: 'GRADING_FEE_BLOCKED',
            schoolId: request.schoolId,
            targetType: 'GRADING',
          } satisfies NotificationFanoutJobData,
          { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to enqueue the owner notice for promotion fee ${request.id}: ${err}`);
    }
  }

  /** The member's notice (as ChargesService.notify()): type CHARGE, opening
   * their invoices; a Guardian gets a copy from the fanout job. Best-effort. */
  private async notify(studentId: string, schoolId: string, key: string, n: { title: string; body: string; targetId: string }) {
    try {
      await this.fanoutQueue.add(
        'notify',
        { notificationId: key, userId: studentId, title: n.title, body: n.body, type: 'CHARGE', schoolId, targetType: 'PAYMENT', targetId: n.targetId } satisfies NotificationFanoutJobData,
        { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${key}: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** A request the caller can see (the request's RLS: owner, the student, a
   * Guardian, or staff who cover the student). Anything else is a 404, so
   * another School learns nothing. */
  private async find(callerId: string, requestId: string): Promise<PromotionFeeRequest> {
    this.assertUuid(requestId, 'id');
    const request = await this.prismaApp.withTenantContext(callerId, (tx) => tx.promotionFeeRequest.findUnique({ where: { id: requestId } }));
    if (!request) throw new NotFoundException('Fee request not found');
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    if (impersonationSchoolId && impersonationSchoolId !== request.schoolId) throw new NotFoundException('Fee request not found');
    return request;
  }

  private async findForOwner(callerId: string, requestId: string): Promise<PromotionFeeRequest> {
    const request = await this.find(callerId, requestId);
    try {
      await this.tenantAuth.assertSchoolOwner(callerId, request.schoolId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      throw new ForbiddenException('Only the School owner can waive or cancel a promotion fee.');
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, request.schoolId);
    return request;
  }

  /** The student, or an active Guardian of the student. */
  private async assertPayer(callerId: string, studentId: string): Promise<void> {
    this.assertUuid(studentId, 'id');
    if (callerId === studentId) return;
    try {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      throw new ForbiddenException('Only the student, or their Guardian, can see and answer their promotion fees.');
    }
  }

  private async reread(studentId: string, requestId: string) {
    const row = await this.prismaApp.withTenantContext(studentId, (tx) => tx.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } }));
    return (await this.shapeWithCharges([row]))[0];
  }

  /**
   * shape() plus each request's charge (step 6), and for a PENDING request the
   * tax accepting would add today. The caller already checked who may see
   * these requests; their charges are read on the jobs connection, as the
   * Payments card's late-fee details are (a charge always belongs to its
   * request's student and School, a database trigger holds it).
   */
  private async shapeWithCharges(rows: PromotionFeeRequest[]) {
    const ids = rows.map((r) => r.id);
    const charges = ids.length
      ? await this.prismaJobs.charge.findMany({ where: { promotionFeeRequestId: { in: ids } }, include: { allocations: { select: { amount: true } } } })
      : [];
    const chargeOf = new Map(charges.map((c) => [c.promotionFeeRequestId!, c]));
    const pendingSchools = [...new Set(rows.filter((r) => r.status === 'PENDING').map((r) => r.schoolId))];
    const schools = pendingSchools.length
      ? await this.prismaJobs.school.findMany({ where: { id: { in: pendingSchools } }, select: { id: true, defaultCurrency: true, taxRateBasisPoints: true, taxInclusive: true } })
      : [];
    const schoolOf = new Map(schools.map((s) => [s.id, s]));
    return rows.map((r) => {
      const c = chargeOf.get(r.id);
      const school = r.status === 'PENDING' ? schoolOf.get(r.schoolId) : undefined;
      const currency = (r.currency ?? school?.defaultCurrency)?.toUpperCase();
      let taxPreview: { netAmount: number; taxAmount: number; grossAmount: number; taxRateBasisPoints: number; taxInclusive: boolean; currency: string } | null = null;
      if (school && currency) {
        try {
          const t = computeCharge({ unitAmount: r.amountMinor, discount: null, taxRateBasisPoints: school.taxRateBasisPoints, taxInclusive: school.taxInclusive });
          taxPreview = { netAmount: t.netAmount, taxAmount: t.taxAmount, grossAmount: t.grossAmount, taxRateBasisPoints: school.taxRateBasisPoints, taxInclusive: school.taxInclusive, currency };
        } catch {
          taxPreview = null;
        }
      }
      const charge = c
        ? {
            id: c.id,
            invoiceLabel: formatInvoiceNumber(c.invoiceNumber),
            status: (c.cancelledAt ? 'CANCELLED' : owedOn(c) === 0 ? 'PAID' : paidOn(c) > 0 ? 'PART_PAID' : 'OPEN') as 'OPEN' | 'PART_PAID' | 'PAID' | 'CANCELLED',
            netAmount: c.netAmount,
            taxAmount: c.taxAmount,
            grossAmount: c.grossAmount,
            taxRateBasisPoints: c.taxRateBasisPoints,
            taxInclusive: c.taxInclusive,
            paidAmount: paidOn(c),
            owedAmount: owedOn(c),
            currency: c.currency,
            dueDate: c.dueDate.toISOString().slice(0, 10),
          }
        : null;
      return { ...this.shape(r), charge, taxPreview };
    });
  }

  private assertUuid(value: string, name: string) {
    if (!UUID_PATTERN.test(value ?? '')) throw new BadRequestException(`${name} must be a valid UUID`);
  }

  /** The response shape (PromotionFeeRequestResponseDto). The planned grade
   * itself stays internal; its grading date is shown. */
  shape(r: PromotionFeeRequest) {
    const pg = r.pendingGrade as unknown as PendingGrade | null;
    return {
      id: r.id,
      schoolId: r.schoolId,
      studentId: r.studentId,
      disciplineId: r.disciplineId,
      toDisciplineId: r.toDisciplineId,
      toRungId: r.toRungId,
      toRungName: r.toRungName,
      expectedCurrentRungId: r.expectedCurrentRungId,
      amountMinor: r.amountMinor,
      currency: r.currency,
      status: r.status,
      promotionWaits: r.promotionWaits,
      promotionApplied: r.promotionEventId !== null,
      promotionEventId: r.promotionEventId,
      gradingDate: pg?.effectiveDate ?? null,
      toDecide: isOpenToDecide(r),
      promotionBlocked: isPromotionBlocked(r),
      promotionBlockedAt: r.promotionBlockedAt,
      toDecideAt: r.toDecideAt,
      toDecideResolution: r.toDecideResolution,
      acceptedAt: r.acceptedAt,
      declinedAt: r.declinedAt,
      paidAt: r.paidAt,
      waivedAt: r.waivedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
    };
  }
}
