import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { RequestContext } from '../common/request-context';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { GuardiansService } from '../guardians/guardians.service';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { recordStaffActivity } from '../tenants/staff-activity/staff-activity';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { dayIn, dayToDate } from '../memberships/freeze/membership-freeze';
import { ChargeMathsError, computeCharge, formatInvoiceNumber, taxForCharge } from './charge-maths';
import { STANDARD_TAX_RATES } from './standard-tax-rates';
import { chargeAbilities, type ChargeAbilities } from './charge-abilities';
import {
  allocate,
  chargePaid,
  chargeRemaining,
  ChargeRefundError,
  freeCredit,
  giveCredit,
  lockBalance,
  paymentRefundable,
  receiptNotice,
  refundNotice,
  recordChargeRefund,
} from './charge-ledger';
import { lateFeeWaivedNotice } from '../late-fees/late-fee-notices';
import { insertCharge, lockInvoiceNumbers } from './charge-insert';
import { cancelChargeInTx, chargeCancelledNotice } from './charge-cancel';
import { PromotionFeeService } from '../ranks/promotion-fee.service';
import { PaymentsService } from '../payments/payments.service';
import { cardSurchargeAmount, readCardSurchargeBps } from '../payments/card-surcharge';
import { StepUpService } from '../auth/step-up.service';
import {
  CancelChargeDto,
  LateFeeDetails,
  PromotionFeeChargeDetails,
  ChargePaymentChannelValue,
  ChargePaymentMethod,
  ChargePaymentStatus,
  ChargeStatus,
  CreateChargeDto,
  GiveCreditDto,
  RecordChargePaymentDto,
  RefundChargePaymentDto,
  RefundStatus,
  SetChargeAutoPayDto,
  SetChargePermissionDto,
  StartChargeCheckoutDto,
} from './dto/charge.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same repeat guard as a desk sale (DESK_REPEAT, memberships.service.ts). */
const DESK_REPEAT_WINDOW_MS = 60_000;
const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] as const;

type Tx = Prisma.TransactionClient;


type ChargeRow = Prisma.ChargeGetPayload<{ include: { allocations: { select: { amount: true } } } }>;
type EntryRow = Prisma.BalanceEntryGetPayload<object>;
type AllocationRow = Prisma.ChargeAllocationGetPayload<object>;
type RefundRow = Prisma.ChargeRefundGetPayload<object>;
/** A CHARGE_PAYMENT Transaction, as the payments list needs it (step 2). */
type PaymentTxRow = {
  id: string;
  status: ChargePaymentStatus;
  chargePaymentChannel: ChargePaymentChannelValue | null;
  surchargeAmount: number;
  amount: number;
  currency: string | null;
  chargeId: string | null;
  paymentMethod: string;
  createdAt: Date;
};
/** Repeated Checkout taps within this window reach Stripe with the same
 * idempotency key and get the same session back (as MembershipsService's
 * PURCHASE_KEY_WINDOW_MS does for a plan). */
const CHECKOUT_KEY_WINDOW_MS = 10 * 60 * 1000;

/** Money as the API's English notices write it ("120.00 BRL"); @ultm8/i18n
 * matches the shape and shows it in the reader's language. */
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;

/**
 * Staff-created charges and the member balance, step 1 of 6 (v1.3 backlog
 * §3.6; Decisions 303, 338, 411).
 *
 * - A charge's tax comes from the School's settings when it is created and is
 *   kept on the charge (Decision 411). Its invoice number runs per School,
 *   with no gaps: numbers are handed out under a per-School lock inside the
 *   transaction that inserts the charge, so a failed insert hands out nothing.
 * - The balance is the sum of BalanceEntry rows (Decision 303 item 2): + a
 *   charge, − a cancelled charge, − a desk payment. Money not yet put toward
 *   a charge is credit, and is put toward open charges, oldest due first, as
 *   soon as there are any (a new charge, an overpayment, a cancelled charge
 *   that was partly paid). ChargeAllocation records each step.
 * - Every write runs on the jobs connection after the checks here, under a
 *   per-student lock, so two desk payments never use the same credit twice.
 *
 * Who (Decision 303 item 3, Decision 338 items 1 and 9):
 * - create: the owner; staff who cover the student and have "Can create
 *   charges" (on by default for Branch Staff, off for Instructors).
 * - cancel: the owner; covering staff with "Can cancel charges" (off).
 * - record a desk payment: the owner; Branch Staff who cover the student
 *   when the School lets Branch Staff record payments (Decision 347's
 *   existing switch, reused). Instructors never.
 */
@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly guardiansService: GuardiansService,
    private readonly paymentsService: PaymentsService,
    private readonly stepUpService: StepUpService,
    private readonly promotionFees: PromotionFeeService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  /** GET /tax-rates: ULTM8's list of standard rates, for the School page's pre-fill. */
  standardTaxRates() {
    return { items: STANDARD_TAX_RATES.map((r) => ({ ...r })) };
  }

  // ---------------------------------------------------------------------------
  // Who may do what
  // ---------------------------------------------------------------------------

  /** What the caller may do with this student's charges at this School
   * (charge-abilities.ts, shared with a membership's cash-payment cancel). */
  async abilities(callerId: string, schoolId: string, studentId: string): Promise<ChargeAbilities> {
    return chargeAbilities(this.prismaApp, this.tenantAuth, callerId, schoolId, studentId);
  }

  private async assertMay(callerId: string, schoolId: string, studentId: string, what: 'create' | 'cancel' | 'recordPayment' | 'read') {
    this.assertUuid(studentId);
    const can = await this.abilities(callerId, schoolId, studentId);
    const allowed = what === 'read' ? can.create || can.cancel || can.recordPayment : can[what];
    if (allowed) return can;
    if (what === 'recordPayment') {
      // Decision 347's own wording, as for a membership sold at the desk.
      const staff = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.roleGrant.findFirst({ where: { userId: callerId, schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { id: true } }),
      );
      throw new ForbiddenException(staff ? 'The School owner has not let Branch Staff record payments.' : "Only that School's Owner/Manager may perform this action.");
    }
    const message = {
      create: "The School owner hasn't let you create charges.",
      cancel: "The School owner hasn't let you cancel charges.",
      read: "The School owner hasn't let you see this student's charges.",
    }[what];
    throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message });
  }

  // ---------------------------------------------------------------------------
  // Staff: the student's Payments card
  // ---------------------------------------------------------------------------

  /** GET /schools/{schoolId}/students/{studentId}/charges. Read under the
   * caller's own context: RLS shows the owner and covering staff the rows. */
  async listForStaff(callerId: string, schoolId: string, studentId: string) {
    const can = await this.assertMay(callerId, schoolId, studentId, 'read');
    const school = await this.loadSchool(schoolId);
    const data = await this.prismaApp.withTenantContext(callerId, (tx) => this.readLedger(tx, schoolId, studentId));
    const view = await this.shapeLedger(data, await this.readPaymentTransactions(schoolId, studentId), school.timezone, true, can.owner);
    return {
      ...view,
      deskMembershipPayments: can.cancel ? await this.readDeskMembershipPayments(schoolId, studentId) : [],
      can: { create: can.create, cancel: can.cancel, recordPayment: can.recordPayment, refund: can.owner, addCredit: can.owner, resendInvoice: can.create },
      settings: {
        currency: school.defaultCurrency?.toUpperCase() ?? null,
        taxCountry: school.taxCountry,
        taxRateBasisPoints: school.taxRateBasisPoints,
        taxInclusive: school.taxInclusive,
        cancelReasonRequired: school.chargeCancelReasonRequired,
        paymentsSetUp: !!(await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } })),
        refundNotesRequired: school.chargeRefundNotesRequired,
        receiptNotice: school.chargeNoticeReceipt,
      },
    };
  }

  /** POST /schools/{schoolId}/students/{studentId}/charges (Decision 303). */
  async create(callerId: string, schoolId: string, studentId: string, dto: CreateChargeDto) {
    await this.assertMay(callerId, schoolId, studentId, 'create');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    const isStudent = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!isStudent) {
      throw new BadRequestException({ code: 'CHARGE_NOT_A_STUDENT', message: 'Charges can only be created for a current student of this School.' });
    }
    const school = await this.loadSchool(schoolId);
    const currency = school.defaultCurrency?.toUpperCase();
    if (!currency) {
      throw new BadRequestException({ code: 'CHARGE_NO_CURRENCY', message: "Set the School's currency on the School page before creating charges." });
    }
    if (!!dto.discountType !== (dto.discountValue !== null && dto.discountValue !== undefined)) {
      throw new BadRequestException({ code: 'CHARGE_DISCOUNT_INVALID', message: 'A discount must be more than 0.' });
    }
    // Decision 414 item 5: "No tax on this item (0% or exempt)", off by default.
    const taxExempt = dto.taxExempt === true;
    const tax = taxForCharge(school, taxExempt);
    let totals;
    try {
      totals = computeCharge({
        unitAmount: dto.amount,
        discount: dto.discountType ? { type: dto.discountType, value: dto.discountValue! } : null,
        ...tax,
      });
    } catch (err) {
      if (err instanceof ChargeMathsError) throw new BadRequestException({ code: `CHARGE_${err.code}`, message: err.message });
      throw err;
    }

    const { id } = await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      // Invoice numbers: one at a time per School, so they never repeat or skip.
      await lockInvoiceNumbers(tx, schoolId);
      await lockBalance(tx, schoolId, studentId);
      const recent = await tx.charge.findFirst({
        where: { schoolId, studentId, description: dto.description, unitAmount: dto.amount, createdById: callerId, createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      return insertCharge(tx, {
        schoolId,
        studentId,
        description: dto.description,
        unitAmount: dto.amount,
        discountType: dto.discountType ?? null,
        discountValue: dto.discountType ? dto.discountValue! : null,
        taxCountry: school.taxCountry,
        ...tax,
        taxExempt,
        totals,
        currency,
        dueDate: dayToDate(dto.dueDate),
        createdById: callerId,
      });
    });

    const charge = await this.prismaJobs.charge.findUniqueOrThrow({ where: { id }, include: { allocations: { select: { amount: true } } } });
    await this.notify(studentId, schoolId, `charge-created-${id}`, 'New invoice', invoiceNoticeBody(charge), id);
    return (await this.shapeCharges([charge], school.timezone, true))[0];
  }

  /**
   * POST /schools/{schoolId}/charges/{chargeId}/cancel (Decision 338 item 1),
   * and POST .../waive-late-fee (Decision 413 item 4, `waive`): waiving a late
   * fee is cancelling it, by the same people (the owner, and covering staff
   * with "Can cancel charges"), through the same ledger writes, with no reason
   * asked for; the charge is marked waived instead.
   */
  async cancel(callerId: string, schoolId: string, chargeId: string, dto: CancelChargeDto, waive = false) {
    this.assertUuid(chargeId);
    const found = await this.prismaJobs.charge.findFirst({
      where: { id: chargeId, schoolId },
      select: { studentId: true, lateFeeOverdueAmount: true, promotionFeeRequestId: true },
    });
    if (!found) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    await this.assertMay(callerId, schoolId, found.studentId, 'cancel');
    // Backlog §3.6 step 6: a promotion fee's charge goes with its fee. Waiving
    // and cancelling a fee are different outcomes for the promotion (Decisions
    // 300, 307), are the owner's alone, and are done from grading, which
    // cancels the charge. Cancelling the charge here would pick one of them for
    // the owner, or let staff with "Can cancel charges" do what only the owner
    // may, so it is refused.
    if (found.promotionFeeRequestId) {
      throw new ConflictException({
        code: 'CHARGE_IS_PROMOTION_FEE',
        message: "This is a promotion fee. The School owner waives or cancels it from the student's grading, which cancels this charge.",
      });
    }
    const isLateFee = found.lateFeeOverdueAmount !== null;
    if (waive && !isLateFee) {
      throw new BadRequestException({ code: 'CHARGE_NOT_A_LATE_FEE', message: 'Only a late fee can be waived.' });
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const school = await this.loadSchool(schoolId);
    const reason = waive ? null : dto.reason?.trim() || null;
    if (!waive && !reason && school.chargeCancelReasonRequired) {
      throw new BadRequestException({ code: 'CHARGE_CANCEL_REASON_REQUIRED', message: 'Give a reason for cancelling this charge.' });
    }

    const { charge, paid } = await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await lockBalance(tx, schoolId, found.studentId);
      const cancelled = await cancelChargeInTx(tx, { schoolId, chargeId, cancelledById: callerId, reason, lateFeeWaived: waive });
      if (!cancelled) {
        throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
      }
      return cancelled;
    });
    // The credit it freed may have paid a promotion fee in full (step 6).
    await this.promotionFees.settlePaidCharges(schoolId, found.studentId);

    if (isLateFee) {
      // Decision 413: the member is told in their own language, not with the
      // late fee's stored English description.
      const notice = lateFeeWaivedNotice(charge.grossAmount, charge.currency, paid);
      await this.notify(charge.studentId, schoolId, `charge-cancelled-${chargeId}`, notice.title, notice.body, chargeId);
    } else {
      const notice = chargeCancelledNotice(charge.description, charge.grossAmount, charge.currency, paid);
      await this.notify(charge.studentId, schoolId, `charge-cancelled-${chargeId}`, notice.title, notice.body, chargeId);
    }
    const reread = await this.prismaJobs.charge.findUniqueOrThrow({ where: { id: chargeId }, include: { allocations: { select: { amount: true } } } });
    return (await this.shapeCharges([reread], school.timezone, true))[0];
  }

  /** POST /schools/{schoolId}/students/{studentId}/charge-payments (Decision
   * 338 item 9): cash, Pix, bank transfer or a card terminal, against one
   * charge or the balance. A part payment leaves the rest owed; an
   * overpayment goes to the member's other open charges, then to credit. */
  async recordPayment(callerId: string, schoolId: string, studentId: string, dto: RecordChargePaymentDto) {
    await this.assertMay(callerId, schoolId, studentId, 'recordPayment');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    // A current or former student of this School: someone who left may still owe.
    const wasStudent = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT' }, select: { id: true } });
    if (!wasStudent) {
      throw new BadRequestException({ code: 'CHARGE_NOT_A_STUDENT', message: 'Charges can only be created for a current student of this School.' });
    }
    const school = await this.loadSchool(schoolId);
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } });
    if (!account) {
      throw new BadRequestException({ code: 'CHARGE_NO_PAYMENT_ACCOUNT', message: "Set up this School's payments before recording a payment." });
    }
    let currency = school.defaultCurrency?.toUpperCase() ?? null;
    if (dto.chargeId) {
      const target = await this.prismaJobs.charge.findFirst({ where: { id: dto.chargeId, schoolId, studentId }, select: { currency: true } });
      if (!target) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
      currency = target.currency;
    }
    if (!currency) {
      throw new BadRequestException({ code: 'CHARGE_NO_CURRENCY', message: "Set the School's currency on the School page before creating charges." });
    }

    const transactionId = randomUUID();
    await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await lockBalance(tx, schoolId, studentId);
      if (dto.chargeId) {
        const target = await tx.charge.findUniqueOrThrow({ where: { id: dto.chargeId }, include: { allocations: { select: { amount: true } } } });
        if (target.cancelledAt) throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
        if (chargeRemaining(target) <= 0) {
          throw new ConflictException({ code: 'CHARGE_ALREADY_PAID', message: 'This charge is already paid.' });
        }
      }
      const recent = await tx.balanceEntry.findFirst({
        where: {
          schoolId,
          studentId,
          kind: 'PAYMENT',
          amount: -dto.amount,
          paymentMethod: dto.paymentMethod,
          recordedById: callerId,
          createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) },
          transaction: { chargeId: dto.chargeId ?? null },
        },
        select: { id: true },
      });
      if (recent) throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      await tx.transaction.create({
        data: {
          id: transactionId,
          schoolId,
          studentId,
          paymentAccountId: account.id,
          kind: 'CHARGE_PAYMENT',
          chargeId: dto.chargeId ?? null,
          amount: dto.amount,
          currency,
          status: 'SUCCESSFUL',
          paymentMethod: dto.paymentMethod,
          recordedById: callerId,
          chargePaymentChannel: 'DESK',
        },
      });
      await tx.balanceEntry.create({
        data: {
          id: randomUUID(),
          schoolId,
          studentId,
          kind: 'PAYMENT',
          amount: -dto.amount,
          currency,
          transactionId,
          paymentMethod: dto.paymentMethod,
          recordedById: callerId,
        },
      });
      await allocate(tx, schoolId, studentId, currency!, transactionId, dto.chargeId ?? null);
    });
    // A promotion fee this paid in full becomes Paid, and a promotion waiting
    // for it applies (backlog §3.6 step 6).
    await this.promotionFees.settlePaidCharges(schoolId, studentId);

    // Decision 338 item 10: the School may switch receipts off.
    if (dto.sendReceipt !== false && school.chargeNoticeReceipt) {
      const receipt = receiptNotice(transactionId, dto.amount, currency);
      await this.notify(studentId, schoolId, receipt.key, receipt.title, receipt.body, transactionId);
    }
    return this.paymentResult(schoolId, studentId, transactionId, school.timezone, (await this.abilities(callerId, schoolId, studentId)).owner);
  }

  /** The payments list's row for one payment and the balances after it. */
  private async paymentResult(schoolId: string, studentId: string, transactionId: string, timezone: string | null, forOwner: boolean) {
    const data = await this.prismaJobs.$transaction((tx) => this.readLedger(tx, schoolId, studentId));
    const view = await this.shapeLedger(data, await this.readPaymentTransactions(schoolId, studentId), timezone, true, forOwner);
    return { payment: view.payments.find((p) => p.id === transactionId)!, balances: view.balances };
  }

  // ---------------------------------------------------------------------------
  // Step 4: refunds, credit and resending an invoice (Decision 338 items 3
  // and 5; Decision 303 item 3: refunds and credit are owner-only)
  // ---------------------------------------------------------------------------

  /**
   * POST /schools/{schoolId}/charge-payments/{transactionId}/refund. The owner
   * chooses each time where the money goes (Decision 338 item 3):
   * - CARD: back to the card, through Stripe on the School's connected
   *   account, as a Class Pack refund is (PaymentsService.refundPayment,
   *   Decision 291). Only a card payment made in the app or automatically.
   * - MONEY_BACK: a cash, Pix, bank-transfer or card-terminal payment given
   *   back at the desk; only the records change ("Refunding a cash payment
   *   only updates the records").
   * - CREDIT: onto the member's balance as credit.
   * Part refunds are allowed, never more than is left of the payment. The
   * ledger rules are recordChargeRefund()'s (charge-ledger.ts): a refund never
   * re-opens a charge. Notes are required unless the owner made them optional,
   * and are for staff only. The card surcharge (Decision 406) is not refunded:
   * nothing decided says it is, so only the payment toward charges is.
   * The member is sent a "Refund" notice after the commit (Decision 414 item
   * 4), unless the School switched it off; it never carries the notes.
   */
  async refund(callerId: string, schoolId: string, transactionId: string, dto: RefundChargePaymentDto) {
    this.assertUuid(transactionId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const school = await this.loadSchool(schoolId);
    const notes = dto.notes?.trim() || null;
    if (!notes && school.chargeRefundNotesRequired) {
      throw new BadRequestException({ code: 'CHARGE_REFUND_NOTES_REQUIRED', message: 'Add a note for this refund.' });
    }
    const payment = await this.prismaJobs.transaction.findFirst({ where: { id: transactionId, schoolId, kind: 'CHARGE_PAYMENT' } });
    if (!payment) throw new NotFoundException({ code: 'CHARGE_PAYMENT_NOT_FOUND', message: 'Payment not found' });
    const card = payment.paymentMethod === 'STRIPE';
    if (dto.destination === 'CARD' && (!card || !payment.stripePaymentIntentId)) {
      throw new BadRequestException({
        code: 'CHARGE_REFUND_NOT_A_CARD_PAYMENT',
        message: "This payment wasn't made by card in the app, so it can't go back to a card. Record the money given back, or give it as credit.",
      });
    }
    if (dto.destination === 'MONEY_BACK' && card) {
      throw new BadRequestException({ code: 'CHARGE_REFUND_CARD_PAYMENT', message: 'A card payment goes back to the card, or onto the balance as credit.' });
    }

    let refundId: string;
    try {
      refundId = await this.prismaJobs.$transaction(
        async (tx) => {
          await lockBalance(tx, schoolId, payment.studentId);
          // The same row lock as CancellationService and the charge.refunded
          // webhook (Decision 382), so the refunded totals never cross.
          await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${payment.id} FOR UPDATE`;
          const fresh = await tx.transaction.findUniqueOrThrow({ where: { id: payment.id } });
          if (fresh.status !== 'SUCCESSFUL') {
            throw new ConflictException({ code: 'CHARGE_REFUND_NOT_PAID', message: 'Only a successful payment can be refunded. A disputed, pending, failed or fully refunded one cannot.' });
          }
          // Checked before Stripe is called; recordChargeRefund checks again.
          const state = await paymentRefundable(tx, fresh);
          if (dto.amount > state.left) throw new ChargeRefundError('CHARGE_REFUND_TOO_MUCH', 'This is more than is left to refund on this payment.');
          if (dto.destination === 'CREDIT' && dto.amount > state.asCredit) {
            throw new ChargeRefundError('CHARGE_REFUND_NOT_ON_CHARGES', 'Only the part of this payment that paid charges can be turned into credit. The rest is credit already.');
          }
          if (dto.destination !== 'CREDIT' && dto.amount > state.asMoney) {
            throw new ChargeRefundError('CHARGE_REFUND_USED_ELSEWHERE', "Part of this payment is credit that has already paid other charges, so it can't be given back.");
          }
          let stripeRefundId: string | null = null;
          if (dto.destination === 'CARD') {
            // One key per state refunded from, as a franchise-fee refund does:
            // a retry of this same refund reaches Stripe as the same request.
            const before = await tx.chargeRefund.aggregate({ where: { transactionId: fresh.id }, _sum: { amount: true } });
            stripeRefundId = await this.paymentsService.refundPayment(
              callerId,
              schoolId,
              fresh.stripePaymentIntentId!,
              dto.amount,
              `charge-refund-${fresh.id}-${before._sum.amount ?? 0}-${dto.amount}`,
            );
          }
          return recordChargeRefund(tx, { transaction: fresh, kind: dto.destination, amount: dto.amount, notes, refundedById: callerId, stripeRefundId });
        },
        { timeout: 20_000 },
      );
    } catch (err) {
      if (err instanceof ChargeRefundError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
    // A refund as credit leaves the money on the balance, where it pays open
    // charges, which may pay a promotion fee in full (step 6).
    await this.promotionFees.settlePaidCharges(schoolId, payment.studentId);

    // Decision 414 item 4: the School may switch refund notices off.
    const notice = school.chargeNoticeRefund && payment.currency ? refundNotice(refundId, dto.destination, dto.amount, payment.currency) : null;
    if (notice) await this.notify(payment.studentId, schoolId, notice.key, notice.title, notice.body, payment.id);
    return this.paymentResult(schoolId, payment.studentId, payment.id, school.timezone, true);
  }

  /** POST /schools/{schoolId}/students/{studentId}/credits: credit the owner
   * gives (goodwill, say), in the School's currency, with a required
   * staff-only note. It pays the member's open charges straight away, as all
   * credit does (Decision 303 item 2). */
  async giveCredit(callerId: string, schoolId: string, studentId: string, dto: GiveCreditDto) {
    this.assertUuid(studentId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const wasStudent = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT' }, select: { id: true } });
    if (!wasStudent) {
      throw new BadRequestException({ code: 'CHARGE_NOT_A_STUDENT', message: 'Charges can only be created for a current student of this School.' });
    }
    const school = await this.loadSchool(schoolId);
    const currency = school.defaultCurrency?.toUpperCase();
    if (!currency) {
      throw new BadRequestException({ code: 'CHARGE_NO_CURRENCY', message: "Set the School's currency on the School page before creating charges." });
    }
    const note = dto.note.trim();
    if (!note) throw new BadRequestException({ code: 'CHARGE_CREDIT_NOTE_REQUIRED', message: 'Add a note saying why this credit is given.' });
    await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await lockBalance(tx, schoolId, studentId);
      const recent = await tx.balanceEntry.findFirst({
        where: { schoolId, studentId, kind: 'CREDIT_GIVEN', amount: -dto.amount, recordedById: callerId, createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      await giveCredit(tx, { schoolId, studentId, currency, amount: dto.amount, note, recordedById: callerId });
    });
    // The credit may have paid a promotion fee in full (step 6).
    await this.promotionFees.settlePaidCharges(schoolId, studentId);
    const data = await this.prismaJobs.$transaction((tx) => this.readLedger(tx, schoolId, studentId));
    const view = await this.shapeLedger(data, await this.readPaymentTransactions(schoolId, studentId), school.timezone, true, true);
    return { balances: view.balances };
  }

  /** POST /schools/{schoolId}/charges/{chargeId}/resend-invoice (Decision 338
   * item 5): the "New invoice" notice again, to the member and a Guardian.
   * Whoever may create charges for the student. Taps within the same minute
   * send it once. */
  async resendInvoice(callerId: string, schoolId: string, chargeId: string) {
    this.assertUuid(chargeId);
    const charge = await this.prismaJobs.charge.findFirst({ where: { id: chargeId, schoolId } });
    if (!charge) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    await this.assertMay(callerId, schoolId, charge.studentId, 'create');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (charge.cancelledAt) throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
    const minute = Math.floor(Date.now() / 60_000);
    await this.notify(charge.studentId, schoolId, `charge-invoice-${chargeId}-${minute}`, 'New invoice', invoiceNoticeBody(charge), chargeId);
    return { sent: true };
  }

  // ---------------------------------------------------------------------------
  // The member (or Guardian): the app's Invoices screen
  // ---------------------------------------------------------------------------

  /** GET /students/{id}/charges: the student's charges and receipts at every
   * School, for the student or an active Guardian. Read under the student's
   * own context, as the app's other reads for a child are. */
  async listForMember(callerId: string, studentId: string) {
    await this.assertMemberOrGuardian(callerId, studentId);
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    const schoolIds = (
      await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.balanceEntry.findMany({ where: { studentId, ...(impersonationSchoolId ? { schoolId: impersonationSchoolId } : {}) }, distinct: ['schoolId'], select: { schoolId: true } }),
      )
    ).map((r) => r.schoolId);
    const schools = await this.prismaJobs.school.findMany({
      where: { id: { in: schoolIds } },
      select: { id: true, name: true, taxId: true, timezone: true, receiptAddress: true, receiptPaymentInstructions: true },
    });
    const restricted = await this.isPaymentRestricted(studentId);
    const out: Array<
      {
        schoolId: string;
        schoolName: string;
        taxId: string | null;
        receiptAddress: string | null;
        receiptPaymentInstructions: string | null;
        payInApp: Awaited<ReturnType<ChargesService['payInApp']>>;
      } & Awaited<ReturnType<ChargesService['shapeLedger']>>
    > = [];
    for (const school of schools.sort((a, b) => a.name.localeCompare(b.name))) {
      const data = await this.prismaApp.withTenantContext(studentId, (tx) => this.readLedger(tx, school.id, studentId));
      const view = await this.shapeLedger(data, await this.readPaymentTransactions(school.id, studentId), school.timezone, false, false);
      const payInApp = await this.payInApp(callerId, studentId, school.id, restricted);
      // Decision 406: the card surcharge, shown before paying.
      const bps = payInApp.available ? await this.prismaApp.withTenantContext(studentId, (tx) => readCardSurchargeBps(tx, school.id)) : 0;
      out.push({
        schoolId: school.id,
        schoolName: school.name,
        taxId: school.taxId,
        // Decision 338 item 6: shown on the School's invoices and receipts.
        receiptAddress: school.receiptAddress,
        receiptPaymentInstructions: school.receiptPaymentInstructions,
        payInApp,
        balances: view.balances.map((b) => ({ ...b, cardSurchargeAmount: cardSurchargeAmount(b.payableAmount, bps) })),
        charges: view.charges.map((c) => ({ ...c, cardSurchargeAmount: cardSurchargeAmount(c.owedAmount, bps) })),
        payments: view.payments,
        credits: view.credits,
      });
    }
    return { schools: out };
  }

  // ---------------------------------------------------------------------------
  // The member (or Guardian): paying in the app (step 2; Decision 303 item 4,
  // Decision 338 item 8)
  // ---------------------------------------------------------------------------

  /**
   * POST /students/{id}/charges/checkout: pay one charge, or the whole
   * balance, by card on a hosted Stripe Checkout on the School's connected
   * account, as a membership is bought (Decisions 238/243). The amount asked
   * is what is owed after credit (Decision 303 item 2), plus the School's card
   * surcharge as its own line (Decision 406). A Pending CHARGE_PAYMENT
   * Transaction is written now; only the payment_intent.succeeded webhook
   * makes it Successful and puts it on the ledger (settleChargePayment), and
   * an abandoned or expired Checkout turns it Failed (Decision 339 item 11).
   * Two sessions open at once can both be paid: the second payment never
   * over-pays a charge, it goes to the next one and then to credit.
   */
  async startCheckout(callerId: string, studentId: string, dto: StartChargeCheckoutDto) {
    await this.assertMemberOrGuardian(callerId, studentId);
    const schoolId = dto.schoolId;
    // A current or former student of this School: someone who left may still owe.
    const wasStudent = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT' }, select: { id: true } });
    if (!wasStudent) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    // A closed School takes no payments (Decision 110), nor a degraded one
    // (Spec 55 §10.2), checked under the student's own context as a
    // membership purchase is.
    await this.tenantAuth.assertSchoolNotArchived(studentId, schoolId);
    await this.subscriptionGate.assertNotDegraded(studentId, schoolId);
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true, provider: true, stripeConnectedAccountId: true } });
    if (!account || account.provider !== 'STRIPE' || !account.stripeConnectedAccountId) {
      throw new BadRequestException({ code: 'CHARGE_NO_CARD_PAYMENTS', message: "This School doesn't take card payments in the app. Pay at the front desk." });
    }
    // Decision 68/112: restricted to cash and bank transfer, as a membership purchase is.
    if (await this.isPaymentRestricted(studentId)) {
      throw new BadRequestException({ code: 'CHARGE_PAYMENT_RESTRICTED', message: 'This account can only pay by cash or bank transfer. Pay at the front desk.' });
    }

    const target = await this.prismaJobs.$transaction(async (tx) => {
      await lockBalance(tx, schoolId, studentId);
      if (dto.chargeId) {
        const charge = await tx.charge.findFirst({ where: { id: dto.chargeId, schoolId, studentId }, include: { allocations: { select: { amount: true } } } });
        if (!charge) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
        if (charge.cancelledAt) throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
        const owed = chargeRemaining(charge);
        const amount = owed - (await freeCredit(tx, schoolId, studentId, charge.currency));
        if (amount <= 0) throw new ConflictException({ code: 'CHARGE_ALREADY_PAID', message: 'This charge is already paid.' });
        return { amount, currency: charge.currency, description: `Invoice ${formatInvoiceNumber(charge.invoiceNumber)}: ${charge.description}` };
      }
      const sums = await tx.balanceEntry.groupBy({ by: ['currency'], where: { schoolId, studentId }, _sum: { amount: true } });
      const owing = sums.filter((r) => (r._sum.amount ?? 0) > 0);
      const wanted = dto.currency?.toUpperCase();
      if (!wanted && owing.length > 1) {
        throw new BadRequestException({ code: 'CHARGE_CHOOSE_CURRENCY', message: 'You owe in more than one currency. Choose which one to pay.' });
      }
      const row = wanted ? owing.find((r) => r.currency === wanted) : owing[0];
      if (!row) throw new ConflictException({ code: 'CHARGE_NOTHING_OWED', message: 'There is nothing to pay.' });
      return { amount: row._sum.amount ?? 0, currency: row.currency, description: 'Balance payment' };
    });

    const surcharge = cardSurchargeAmount(target.amount, await this.prismaApp.withTenantContext(studentId, (tx) => readCardSurchargeBps(tx, schoolId)));
    // The same request while a Checkout is still open gets that session back
    // (a double tap). Once one has ended (paid, or failed or abandoned), the
    // next request is a new session, even for the same amount.
    const ended = await this.prismaJobs.transaction.count({
      where: { schoolId, studentId, kind: 'CHARGE_PAYMENT', chargePaymentChannel: 'APP', status: { not: 'PENDING' } },
    });
    const key = createHash('sha256')
      .update(JSON.stringify([studentId, schoolId, dto.chargeId ?? null, target.amount, target.currency, surcharge, ended]))
      .digest('hex')
      .slice(0, 24);
    const { checkoutUrl, paymentIntentId } = await this.paymentsService.createPurchaseCheckoutSession(
      studentId,
      schoolId,
      target.amount,
      target.currency,
      target.description,
      `charge-checkout-${key}-${Math.floor(Date.now() / CHECKOUT_KEY_WINDOW_MS)}`,
      surcharge,
      'charge-payment',
    );
    const result = { checkoutUrl, amount: target.amount, surchargeAmount: surcharge, currency: target.currency };
    const transactionId = randomUUID();
    try {
      await this.prismaJobs.transaction.create({
        data: {
          id: transactionId,
          schoolId,
          studentId,
          paymentAccountId: account.id,
          kind: 'CHARGE_PAYMENT',
          chargeId: dto.chargeId ?? null,
          amount: target.amount,
          surchargeAmount: surcharge,
          currency: target.currency,
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: paymentIntentId,
          chargePaymentChannel: 'APP',
        },
      });
    } catch (err) {
      // A repeated tap got the same session (and PaymentIntent) back: return its row.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const existing = await this.prismaJobs.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
      if (!existing) throw err;
      return { ...result, transactionId: existing.id };
    }
    return { ...result, transactionId };
  }

  /**
   * PUT /students/{id}/charge-auto-pay: "Pay charges automatically with my
   * saved card" (Decision 338 item 8), per member per School, off by default.
   * Turning it on authorises later charges to the saved card with no one
   * there to confirm them, so it asks for the passcode again (step-up,
   * Decisions 236/239), as paying with the saved card does; turning it off
   * never does. The member only: the saved card is theirs (Decision 238), and
   * Decision 239 leaves a Guardian's card for a child undecided.
   */
  async setAutoPay(callerId: string, studentId: string, dto: SetChargeAutoPayDto, stepUpToken?: string) {
    this.assertUuid(studentId);
    if (callerId !== studentId) {
      await this.assertMemberOrGuardian(callerId, studentId);
      throw new BadRequestException({ code: 'CHARGE_AUTO_PAY_SELF_ONLY', message: 'Only the member can set automatic payment, with their own saved card.' });
    }
    if (dto.enabled) {
      this.stepUpService.assertVerified(callerId, stepUpToken);
      if (await this.isPaymentRestricted(studentId)) {
        throw new BadRequestException({ code: 'CHARGE_PAYMENT_RESTRICTED', message: 'This account can only pay by cash or bank transfer. Pay at the front desk.' });
      }
    }
    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentPaymentMethod.updateMany({ where: { studentId, schoolId: dto.schoolId }, data: { autoPayCharges: dto.enabled } }),
    );
    if (updated.count === 0) {
      throw new BadRequestException({ code: 'CHARGE_AUTO_PAY_NO_CARD', message: 'Save a card for this School first.' });
    }
    return { schoolId: dto.schoolId, enabled: dto.enabled };
  }

  /** What the member's Payments screen offers at one School. */
  private async payInApp(callerId: string, studentId: string, schoolId: string, restricted: boolean) {
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { provider: true, stripeConnectedAccountId: true } });
    const cards = !!account && account.provider === 'STRIPE' && !!account.stripeConnectedAccountId;
    const blockedReason: 'NO_CARD_PAYMENTS' | 'RESTRICTED' | null = !cards ? 'NO_CARD_PAYMENTS' : restricted ? 'RESTRICTED' : null;
    // Self-only RLS: read under the student's context; a child never has one.
    const saved = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId, schoolId } }, select: { autoPayCharges: true } }),
    );
    return {
      available: blockedReason === null,
      blockedReason,
      savedCard: !!saved,
      autoPay: !!saved?.autoPayCharges,
      canSetAutoPay: callerId === studentId && !!saved && blockedReason === null,
    };
  }

  private async isPaymentRestricted(studentId: string): Promise<boolean> {
    const user = await this.prismaApp.withTenantContext(studentId, (tx) => tx.user.findUnique({ where: { id: studentId }, select: { paymentRestrictedAt: true } }));
    return !!user?.paymentRestrictedAt;
  }

  /** The student themselves, or an active Guardian of theirs. */
  private async assertMemberOrGuardian(callerId: string, studentId: string) {
    this.assertUuid(studentId);
    if (callerId === studentId) return;
    try {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      throw new ForbiddenException('Only the student, or their Guardian, can see their charges.');
    }
  }

  // ---------------------------------------------------------------------------
  // The owner: who may create and cancel charges (Staff page)
  // ---------------------------------------------------------------------------

  /** GET /schools/{schoolId}/charge-permissions: Branch Staff and coaches,
   * and their two switches. Owner only. */
  async listPermissions(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { grants, permissions } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({ where: { schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { userId: true, role: true } }),
      permissions: await tx.staffPermission.findMany({ where: { schoolId }, select: { userId: true, canCreateCharges: true, canCancelCharges: true } }),
    }));
    const owners = new Set(grants.filter((g) => g.role === 'SCHOOL_OWNER_MANAGER').map((g) => g.userId));
    const roles = new Map<string, Set<'BRANCH_STAFF' | 'INSTRUCTOR'>>();
    for (const g of grants) {
      // The owner always can, so owners aren't listed.
      if (g.role === 'SCHOOL_OWNER_MANAGER' || owners.has(g.userId)) continue;
      roles.set(g.userId, (roles.get(g.userId) ?? new Set()).add(g.role as 'BRANCH_STAFF' | 'INSTRUCTOR'));
    }
    const names = await resolveUserNames(this.prismaAuth, [...roles.keys()]);
    const byUser = new Map(permissions.map((p) => [p.userId, p]));
    const items = [...roles.entries()].map(([userId, r]) => ({
      userId,
      firstName: names.get(userId)?.firstName ?? '',
      surname: names.get(userId)?.surname ?? '',
      roles: [...r].sort(),
      canCreateCharges: byUser.get(userId)?.canCreateCharges ?? r.has('BRANCH_STAFF'),
      canCancelCharges: byUser.get(userId)?.canCancelCharges ?? false,
    }));
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
    return { items };
  }

  /** PUT /schools/{schoolId}/charge-permissions/{userId}. Owner only; Branch
   * Staff and coaches only. Logged on the Staff page's activity log
   * (Decision 408), one line listing each switch that changed. */
  async setPermission(callerId: string, schoolId: string, userId: string, dto: SetChargePermissionDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const before = (await this.listPermissions(callerId, schoolId)).items.find((i) => i.userId === userId);
    if (!before) {
      throw new BadRequestException('"Can create charges" and "Can cancel charges" are for Branch Staff and coaches at this School.');
    }
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, canCreateCharges: dto.canCreateCharges, canCancelCharges: dto.canCancelCharges, grantedById: callerId },
        update: { canCreateCharges: dto.canCreateCharges, canCancelCharges: dto.canCancelCharges, grantedById: callerId },
      });
      const changes = [
        ...(before.canCreateCharges !== dto.canCreateCharges ? [{ switch: 'createCharges', on: dto.canCreateCharges }] : []),
        ...(before.canCancelCharges !== dto.canCancelCharges ? [{ switch: 'cancelCharges', on: dto.canCancelCharges }] : []),
      ];
      if (changes.length > 0) {
        await recordStaffActivity(tx, { schoolId, actorId: callerId, targetUserId: userId, action: 'CHARGE_ACCESS_CHANGED', details: { changes } });
      }
    });
    return { ...before, canCreateCharges: dto.canCreateCharges, canCancelCharges: dto.canCancelCharges };
  }

  // ---------------------------------------------------------------------------
  // The ledger
  // ---------------------------------------------------------------------------

  // lockBalance(), allocate() and settleChargePayment() live in
  // charge-ledger.ts, shared with the webhook and the auto-pay job.

  private async readLedger(tx: Tx, schoolId: string, studentId: string) {
    const [charges, entries, allocations, refunds] = await Promise.all([
      tx.charge.findMany({ where: { schoolId, studentId }, include: { allocations: { select: { amount: true } } } }),
      tx.balanceEntry.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      tx.chargeAllocation.findMany({ where: { schoolId, studentId } }),
      tx.chargeRefund.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    return { schoolId, charges, entries, allocations, refunds };
  }

  /** The student's CHARGE_PAYMENT Transactions at one School, read on the jobs
   * connection after the caller's access was checked (Branch Staff can't read
   * Transaction under their own context, Spec 55 §8.2): how each payment was
   * made, its surcharge, and the card payments still Pending or that failed. */
  private async readPaymentTransactions(schoolId: string, studentId: string): Promise<PaymentTxRow[]> {
    return this.prismaJobs.transaction.findMany({
      where: { schoolId, studentId, kind: 'CHARGE_PAYMENT' },
      select: { id: true, status: true, chargePaymentChannel: true, surchargeAmount: true, amount: true, currency: true, chargeId: true, paymentMethod: true, createdAt: true },
    });
  }

  /** Decision 338 item 1 (last point): the student's membership payments by
   * cash or bank transfer still waiting at the desk, and the ones cancelled,
   * so the owner and staff with "Can cancel charges" can cancel them from the
   * Payments card (PATCH /transactions/{id}/cancel). Read on the jobs
   * connection after the caller's access was checked, as above. */
  private async readDeskMembershipPayments(schoolId: string, studentId: string) {
    const rows = await this.prismaJobs.transaction.findMany({
      where: {
        schoolId,
        studentId,
        kind: { not: 'CHARGE_PAYMENT' },
        paymentMethod: { not: 'STRIPE' },
        OR: [{ status: 'PENDING' }, { status: 'FAILED', cancelledAt: { not: null } }],
      },
      include: {
        membershipPlan: { select: { title: true } },
        membership: { select: { membershipPlan: { select: { title: true } } } },
      },
      orderBy: [{ billingDate: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const names = await resolveUserNames(this.prismaAuth, rows.map((r) => r.cancelledById).filter((id): id is string => !!id));
    return rows.map((r) => {
      const n = r.cancelledById ? names.get(r.cancelledById) : undefined;
      return {
        id: r.id,
        kind: r.kind as 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE' | 'FREEZE_FEE',
        membershipPlanTitle: r.membershipPlan?.title ?? r.membership?.membershipPlan.title ?? null,
        amount: r.amount,
        currency: r.currency ? r.currency.toUpperCase() : null,
        paymentMethod: r.paymentMethod,
        billingDate: r.billingDate.toISOString(),
        status: r.cancelledAt ? ('CANCELLED' as const) : ('PENDING' as const),
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelledByName: n ? `${n.firstName} ${n.surname}`.trim() : null,
        cancelReason: r.cancelReason,
      };
    });
  }

  private async shapeLedger(
    data: { schoolId: string; charges: ChargeRow[]; entries: EntryRow[]; allocations: AllocationRow[]; refunds: RefundRow[] },
    transactions: PaymentTxRow[],
    timezone: string | null,
    forStaff: boolean,
    /** The owner: each Successful payment says what can still be refunded. */
    forOwner = false,
  ) {
    const charges = await this.shapeCharges(data.charges, timezone, forStaff);
    const order = (c: { status: ChargeStatus }) => (c.status === 'OPEN' || c.status === 'PART_PAID' ? 0 : c.status === 'PAID' ? 1 : 2);
    charges.sort((a, b) => order(a) - order(b) || (order(a) === 0 ? a.dueDate.localeCompare(b.dueDate) : b.createdAt.localeCompare(a.createdAt)) || b.invoiceNumber - a.invoiceNumber);

    const byCurrency = new Map<string, { owed: number; overdue: number; sum: number }>();
    const bucket = (c: string) => byCurrency.get(c) ?? byCurrency.set(c, { owed: 0, overdue: 0, sum: 0 }).get(c)!;
    for (const e of data.entries) bucket(e.currency).sum += e.amount;
    for (const c of charges) {
      const b = bucket(c.currency);
      b.owed += c.owedAmount;
      if (c.overdue) b.overdue += c.owedAmount;
    }
    const balances = [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, b]) => ({
        schoolId: data.schoolId,
        currency,
        owed: b.owed,
        credit: Math.max(0, b.owed - b.sum),
        net: b.sum,
        overdue: b.overdue,
        payableAmount: Math.max(0, b.sum),
        cardSurchargeAmount: 0,
      }));

    const invoiceOf = new Map(data.charges.map((c) => [c.id, formatInvoiceNumber(c.invoiceNumber)]));
    const txOf = new Map(transactions.map((t) => [t.id, t]));
    const recorders = forStaff
      ? await resolveUserNames(
          this.prismaAuth,
          [...data.entries.map((e) => e.recordedById), ...data.refunds.map((r) => r.refundedById)].filter((id): id is string => !!id),
        )
      : new Map();
    const nameOf = (id: string | null) => {
      const n = forStaff && id ? recorders.get(id) : undefined;
      return n ? `${n.firstName} ${n.surname}`.trim() : null;
    };
    const credit = new Map(balances.map((b) => [b.currency, b.credit]));
    const cancelled = new Set(data.charges.filter((c) => c.cancelledAt).map((c) => c.id));
    const settled = data.entries
      .filter((e) => e.kind === 'PAYMENT')
      .map((e) => {
        // A refund's negative rows are not where the payment went.
        const allocations = data.allocations
          .filter((a) => a.transactionId === e.transactionId && !a.refundId)
          .map((a) => ({ chargeId: a.chargeId, invoiceLabel: invoiceOf.get(a.chargeId) ?? '', amount: a.amount }));
        const recorder = e.recordedById ? recorders.get(e.recordedById) : undefined;
        const t = e.transactionId ? txOf.get(e.transactionId) : undefined;
        const refunds = data.refunds.filter((r) => r.transactionId === e.transactionId);
        const refundedAmount = refunds.reduce((n, r) => n + r.amount, 0);
        const paidAmount = -e.amount;
        const refundStatus: RefundStatus | null = refundedAmount <= 0 ? null : refundedAmount >= paidAmount ? 'REFUNDED' : 'PART_REFUNDED';
        // The same sums as paymentRefundable() (charge-ledger.ts), from what
        // is loaded; the refund itself checks again under the lock.
        let refundable: { asMoney: number; asCredit: number } | null = null;
        if (forOwner && (t?.status ?? 'SUCCESSFUL') === 'SUCCESSFUL') {
          const left = Math.max(0, paidAmount - refundedAmount);
          const net = data.allocations
            .filter((a) => a.transactionId === e.transactionId && !cancelled.has(a.chargeId))
            .reduce((m, a) => m.set(a.chargeId, (m.get(a.chargeId) ?? 0) + a.amount), new Map<string, number>());
          const onCharges = Math.min(left, [...net.values()].filter((v) => v > 0).reduce((n, v) => n + v, 0));
          refundable = { asMoney: Math.min(left - onCharges, credit.get(e.currency) ?? 0) + onCharges, asCredit: onCharges };
        }
        return {
          refundedAmount,
          refundStatus,
          refunds: refunds.map((r) => ({
            id: r.id,
            kind: r.kind,
            amount: r.amount,
            refundedAt: r.createdAt.toISOString(),
            notes: forStaff ? r.notes : null,
            refundedByName: nameOf(r.refundedById),
          })),
          refundable,
          id: e.transactionId!,
          schoolId: e.schoolId,
          amount: -e.amount,
          currency: e.currency,
          paymentMethod: e.paymentMethod as ChargePaymentMethod,
          channel: t?.chargePaymentChannel ?? ('DESK' as const),
          status: t?.status ?? ('SUCCESSFUL' as const),
          surchargeAmount: t?.surchargeAmount ?? 0,
          invoiceLabel: t?.chargeId ? (invoiceOf.get(t.chargeId) ?? null) : null,
          receivedAt: e.createdAt.toISOString(),
          recordedByName: forStaff && recorder ? `${recorder.firstName} ${recorder.surname}`.trim() : null,
          allocations,
          creditAmount: -e.amount - allocations.reduce((n, a) => n + a.amount, 0),
        };
      });
    // Card payments not on the ledger: Pending ones (started in the app, or an
    // automatic charge in flight), and automatic charges that failed. A
    // Checkout the member walked away from (Failed, APP) isn't shown.
    const open = transactions
      .filter((t) => t.status === 'PENDING' || (t.status === 'FAILED' && t.chargePaymentChannel === 'AUTOMATIC'))
      .map((t) => ({
        id: t.id,
        schoolId: data.schoolId,
        amount: t.amount,
        currency: t.currency ?? '',
        paymentMethod: t.paymentMethod as ChargePaymentMethod,
        channel: t.chargePaymentChannel ?? ('DESK' as const),
        status: t.status,
        surchargeAmount: t.surchargeAmount,
        invoiceLabel: t.chargeId ? (invoiceOf.get(t.chargeId) ?? null) : null,
        receivedAt: t.createdAt.toISOString(),
        recordedByName: null,
        allocations: [] as Array<{ chargeId: string; invoiceLabel: string; amount: number }>,
        creditAmount: 0,
        refundedAmount: 0,
        refundStatus: null,
        refunds: [] as Array<{ id: string; kind: RefundRow['kind']; amount: number; refundedAt: string; notes: string | null; refundedByName: string | null }>,
        refundable: null,
      }));
    const payments = [...settled, ...open].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
    // Credit the owner gave (step 4). The note is for staff only.
    const credits = data.entries
      .filter((e) => e.kind === 'CREDIT_GIVEN')
      .map((e) => ({
        id: e.id,
        amount: -e.amount,
        currency: e.currency,
        givenAt: e.createdAt.toISOString(),
        note: forStaff ? e.note : null,
        givenByName: nameOf(e.recordedById),
      }));
    return { balances, charges, payments, credits };
  }

  private async shapeCharges(rows: ChargeRow[], timezone: string | null, forStaff: boolean) {
    const today = dayIn(new Date(), timezone);
    const names = forStaff
      ? await resolveUserNames(this.prismaAuth, rows.flatMap((c) => [c.createdById, c.cancelledById]).filter((id): id is string => !!id))
      : new Map();
    const nameOf = (id: string | null) => {
      const n = forStaff && id ? names.get(id) : undefined;
      return n ? `${n.firstName} ${n.surname}`.trim() : null;
    };
    const lateFees = await this.lateFeeDetails(rows, timezone);
    const promotionFees = await this.promotionFeeDetails(rows);
    return rows.map((c) => {
      const paid = chargePaid(c);
      const cancelled = !!c.cancelledAt;
      const owed = cancelled ? 0 : Math.max(0, chargeRemaining(c));
      const status: ChargeStatus = cancelled ? 'CANCELLED' : owed === 0 ? 'PAID' : paid > 0 ? 'PART_PAID' : 'OPEN';
      const due = dayString(c.dueDate);
      return {
        id: c.id,
        schoolId: c.schoolId,
        studentId: c.studentId,
        invoiceNumber: c.invoiceNumber,
        invoiceLabel: formatInvoiceNumber(c.invoiceNumber),
        description: c.description,
        unitAmount: c.unitAmount,
        discountType: c.discountType,
        discountValue: c.discountValue,
        discountAmount: c.discountAmount,
        taxCountry: c.taxCountry,
        taxRateBasisPoints: c.taxRateBasisPoints,
        taxInclusive: c.taxInclusive,
        taxExempt: c.taxExempt,
        netAmount: c.netAmount,
        taxAmount: c.taxAmount,
        grossAmount: c.grossAmount,
        currency: c.currency,
        dueDate: due,
        paidAmount: paid,
        owedAmount: owed,
        status,
        overdue: owed > 0 && due < today,
        createdAt: c.createdAt.toISOString(),
        createdByName: nameOf(c.createdById),
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        cancelledByName: nameOf(c.cancelledById),
        cancelReason: forStaff ? c.cancelReason : null,
        cardSurchargeAmount: 0,
        // Step 4 (Decision 338 item 3): what was refunded off its total.
        refundedAmount: c.refundedAmount,
        refundStatus: c.refundedAmount <= 0 ? null : c.refundedAmount >= c.grossAmount ? ('REFUNDED' as const) : ('PART_REFUNDED' as const),
        lateFee: lateFees.get(c.id) ?? null,
        promotionFee: promotionFees.get(c.id) ?? null,
      };
    });
  }

  /**
   * Decision 413: what each late fee is for, so both apps can label it "Late
   * fee" with the overdue charge or membership payment in the reader's own
   * language. Read on the jobs connection after the caller's access to these
   * charges was checked: a late fee and what it is for always belong to the
   * same student at the same School (the late-fee job writes them so).
   */
  private async lateFeeDetails(rows: ChargeRow[], timezone: string | null): Promise<Map<string, LateFeeDetails>> {
    const out = new Map<string, LateFeeDetails>();
    const fees = rows.filter((c) => c.lateFeeOverdueAmount !== null);
    if (fees.length === 0) return out;
    const chargeIds = fees.map((c) => c.lateFeeForChargeId).filter((id): id is string => !!id);
    const transactionIds = fees.map((c) => c.lateFeeForTransactionId).filter((id): id is string => !!id);
    const [charges, renewals] = await Promise.all([
      this.prismaJobs.charge.findMany({ where: { id: { in: chargeIds } }, select: { id: true, invoiceNumber: true, description: true, dueDate: true, currency: true } }),
      this.prismaJobs.transaction.findMany({ where: { id: { in: transactionIds } }, select: { id: true, billingDate: true, currency: true, membershipPlan: { select: { title: true } } } }),
    ]);
    const chargeOf = new Map(charges.map((c) => [c.id, c]));
    const renewalOf = new Map(renewals.map((r) => [r.id, r]));
    for (const fee of fees) {
      const base = { overdueAmount: fee.lateFeeOverdueAmount!, percentBps: fee.lateFeePercentBps, waived: fee.lateFeeWaived };
      const forCharge = fee.lateFeeForChargeId ? chargeOf.get(fee.lateFeeForChargeId) : undefined;
      const forRenewal = fee.lateFeeForTransactionId ? renewalOf.get(fee.lateFeeForTransactionId) : undefined;
      if (forCharge) {
        out.set(fee.id, {
          ...base,
          forType: 'CHARGE',
          forInvoiceLabel: formatInvoiceNumber(forCharge.invoiceNumber),
          forDescription: forCharge.description,
          forPlanTitle: null,
          forDueDate: dayString(forCharge.dueDate),
          overdueCurrency: forCharge.currency,
        });
      } else if (forRenewal) {
        out.set(fee.id, {
          ...base,
          forType: 'RENEWAL',
          forInvoiceLabel: null,
          forDescription: null,
          forPlanTitle: forRenewal.membershipPlan?.title ?? null,
          forDueDate: dayIn(forRenewal.billingDate, timezone),
          overdueCurrency: (forRenewal.currency ?? fee.currency).toUpperCase(),
        });
      }
    }
    return out;
  }

  /**
   * Backlog §3.6 step 6: the promotion fee each such charge is for, so both
   * apps label it "Promotion fee" with the style and the grade, and the portal
   * links it to the student's grading. Read on the jobs connection after the
   * caller's access to these charges was checked: a charge and its request
   * always belong to the same student at the same School (a database trigger
   * holds it).
   */
  private async promotionFeeDetails(rows: ChargeRow[]): Promise<Map<string, PromotionFeeChargeDetails>> {
    const out = new Map<string, PromotionFeeChargeDetails>();
    const ids = rows.map((c) => c.promotionFeeRequestId).filter((id): id is string => !!id);
    if (ids.length === 0) return out;
    const requests = await this.prismaJobs.promotionFeeRequest.findMany({
      where: { id: { in: ids } },
      select: { id: true, disciplineId: true, toRungName: true, status: true, discipline: { select: { name: true } } },
    });
    const byId = new Map(requests.map((r) => [r.id, r]));
    for (const c of rows) {
      const r = c.promotionFeeRequestId ? byId.get(c.promotionFeeRequestId) : undefined;
      if (!r) continue;
      out.set(c.id, { requestId: r.id, disciplineId: r.disciplineId, disciplineName: r.discipline.name, toRungName: r.toRungName, status: r.status });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadSchool(schoolId: string) {
    const school = await this.prismaJobs.school.findUnique({
      where: { id: schoolId },
      select: {
        defaultCurrency: true,
        timezone: true,
        taxCountry: true,
        taxRateBasisPoints: true,
        taxInclusive: true,
        chargeCancelReasonRequired: true,
        chargeRefundNotesRequired: true,
        chargeNoticeReceipt: true,
        chargeNoticeRefund: true,
      },
    });
    if (!school) throw new NotFoundException('School not found');
    return school;
  }

  /** The member's notice (Decision 338 items 5, 9, 1); a Guardian gets a copy
   * from the fanout job, as for every notice to a child. Best-effort: a notice
   * that fails to enqueue never undoes the change. */
  private async notify(studentId: string, schoolId: string, key: string, title: string, body: string, targetId: string) {
    try {
      await this.fanoutQueue.add(
        'notify',
        { notificationId: key, userId: studentId, title, body, type: 'CHARGE', schoolId, targetType: 'PAYMENT', targetId } satisfies NotificationFanoutJobData,
        { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue the charge notice ${key}: ${err}`);
    }
  }

  private assertUuid(id: string) {
    if (!UUID_PATTERN.test(id)) throw new BadRequestException('id must be a valid UUID');
  }
}

/** The "New invoice" notice (Decision 338 item 5), also sent again on request. */
function invoiceNoticeBody(c: { invoiceNumber: number; description: string; grossAmount: number; currency: string; dueDate: Date }): string {
  return `Invoice ${formatInvoiceNumber(c.invoiceNumber)} for ${c.description}: ${money(c.grossAmount, c.currency)}, due ${dayString(c.dueDate)}.`;
}

/** A @db.Date as YYYY-MM-DD. */
function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
