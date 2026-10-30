import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
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
import { ChargeMathsError, computeCharge, formatInvoiceNumber } from './charge-maths';
import { STANDARD_TAX_RATES } from './standard-tax-rates';
import { CancelChargeDto, ChargeStatus, CreateChargeDto, DeskChargePaymentMethod, RecordChargePaymentDto, SetChargePermissionDto } from './dto/charge.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same repeat guard as a desk sale (DESK_REPEAT, memberships.service.ts). */
const DESK_REPEAT_WINDOW_MS = 60_000;
const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] as const;

type Tx = Prisma.TransactionClient;

export interface ChargeAbilities {
  owner: boolean;
  create: boolean;
  cancel: boolean;
  recordPayment: boolean;
}

type ChargeRow = Prisma.ChargeGetPayload<{ include: { allocations: { select: { amount: true } } } }>;
type EntryRow = Prisma.BalanceEntryGetPayload<object>;
type AllocationRow = Prisma.ChargeAllocationGetPayload<object>;

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
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  /** GET /tax-rates: ULTM8's list of standard rates, for the School page's pre-fill. */
  standardTaxRates() {
    return { items: STANDARD_TAX_RATES.map((r) => ({ ...r })) };
  }

  // ---------------------------------------------------------------------------
  // Who may do what
  // ---------------------------------------------------------------------------

  /** What the caller may do with this student's charges at this School. */
  async abilities(callerId: string, schoolId: string, studentId: string): Promise<ChargeAbilities> {
    const none: ChargeAbilities = { owner: false, create: false, cancel: false, recordPayment: false };
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { role: true } }),
    );
    if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { owner: true, create: true, cancel: true, recordPayment: true };
    if (grants.length === 0) return none;
    try {
      await this.tenantAuth.assertBranchCoversStudent(await this.tenantAuth.staffBranchCoverage(callerId, schoolId), schoolId, studentId);
    } catch (err) {
      if (err instanceof ForbiddenException) return none;
      throw err;
    }
    const branchStaff = grants.some((g) => g.role === 'BRANCH_STAFF');
    const [row, school] = await this.prismaApp.withTenantContext(callerId, async (tx) => [
      await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canCreateCharges: true, canCancelCharges: true } }),
      await tx.school.findUnique({ where: { id: schoolId }, select: { branchStaffCanRecordPayments: true } }),
    ]);
    return {
      owner: false,
      create: row?.canCreateCharges ?? branchStaff,
      cancel: row?.canCancelCharges ?? false,
      recordPayment: branchStaff && !!school?.branchStaffCanRecordPayments,
    };
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
    const view = await this.shapeLedger(data, school.timezone, true);
    return {
      ...view,
      can: { create: can.create, cancel: can.cancel, recordPayment: can.recordPayment },
      settings: {
        currency: school.defaultCurrency?.toUpperCase() ?? null,
        taxCountry: school.taxCountry,
        taxRateBasisPoints: school.taxRateBasisPoints,
        taxInclusive: school.taxInclusive,
        cancelReasonRequired: school.chargeCancelReasonRequired,
        paymentsSetUp: !!(await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } })),
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
    let totals;
    try {
      totals = computeCharge({
        unitAmount: dto.amount,
        discount: dto.discountType ? { type: dto.discountType, value: dto.discountValue! } : null,
        taxRateBasisPoints: school.taxRateBasisPoints,
        taxInclusive: school.taxInclusive,
      });
    } catch (err) {
      if (err instanceof ChargeMathsError) throw new BadRequestException({ code: `CHARGE_${err.code}`, message: err.message });
      throw err;
    }

    const id = randomUUID();
    await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      // Invoice numbers: one at a time per School, so they never repeat or skip.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`charge-invoice:${schoolId}`}, 0))`;
      await this.lockBalance(tx, schoolId, studentId);
      const recent = await tx.charge.findFirst({
        where: { schoolId, studentId, description: dto.description, unitAmount: dto.amount, createdById: callerId, createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      const last = await tx.charge.aggregate({ where: { schoolId }, _max: { invoiceNumber: true } });
      await tx.charge.create({
        data: {
          id,
          schoolId,
          studentId,
          invoiceNumber: (last._max.invoiceNumber ?? 0) + 1,
          description: dto.description,
          unitAmount: dto.amount,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountType ? dto.discountValue! : null,
          discountAmount: totals.discountAmount,
          taxCountry: school.taxCountry,
          taxRateBasisPoints: school.taxRateBasisPoints,
          taxInclusive: school.taxInclusive,
          netAmount: totals.netAmount,
          taxAmount: totals.taxAmount,
          grossAmount: totals.grossAmount,
          currency,
          dueDate: dayToDate(dto.dueDate),
          createdById: callerId,
        },
      });
      await tx.balanceEntry.create({ data: { id: randomUUID(), schoolId, studentId, kind: 'CHARGE', amount: totals.grossAmount, currency, chargeId: id } });
      // Credit already on the balance pays this charge straight away.
      await this.allocate(tx, schoolId, studentId, currency, null, null);
    });

    const charge = await this.prismaJobs.charge.findUniqueOrThrow({ where: { id }, include: { allocations: { select: { amount: true } } } });
    await this.notify(studentId, schoolId, `charge-created-${id}`, 'New invoice', `Invoice ${formatInvoiceNumber(charge.invoiceNumber)} for ${charge.description}: ${money(charge.grossAmount, currency)}, due ${dayString(charge.dueDate)}.`, id);
    return (await this.shapeCharges([charge], school.timezone, true))[0];
  }

  /** POST /schools/{schoolId}/charges/{chargeId}/cancel (Decision 338 item 1). */
  async cancel(callerId: string, schoolId: string, chargeId: string, dto: CancelChargeDto) {
    this.assertUuid(chargeId);
    const found = await this.prismaJobs.charge.findFirst({ where: { id: chargeId, schoolId }, select: { studentId: true } });
    if (!found) throw new NotFoundException({ code: 'CHARGE_NOT_FOUND', message: 'Charge not found' });
    await this.assertMay(callerId, schoolId, found.studentId, 'cancel');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const school = await this.loadSchool(schoolId);
    const reason = dto.reason?.trim() || null;
    if (!reason && school.chargeCancelReasonRequired) {
      throw new BadRequestException({ code: 'CHARGE_CANCEL_REASON_REQUIRED', message: 'Give a reason for cancelling this charge.' });
    }

    const { charge, paid } = await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await this.lockBalance(tx, schoolId, found.studentId);
      const now = new Date();
      const updated = await tx.charge.updateMany({
        where: { id: chargeId, schoolId, cancelledAt: null },
        data: { cancelledAt: now, cancelledById: callerId, cancelReason: reason },
      });
      if (updated.count === 0) {
        throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
      }
      const row = await tx.charge.findUniqueOrThrow({ where: { id: chargeId }, include: { allocations: { select: { amount: true } } } });
      await tx.balanceEntry.create({
        data: { id: randomUUID(), schoolId, studentId: row.studentId, kind: 'CHARGE_CANCELLED', amount: -row.grossAmount, currency: row.currency, chargeId },
      });
      // Anything already paid toward it is credit now, and goes to the next open charge.
      await this.allocate(tx, schoolId, row.studentId, row.currency, null, null);
      return { charge: row, paid: row.allocations.reduce((n, a) => n + a.amount, 0) };
    });

    const body =
      `Your charge '${charge.description}, ${money(charge.grossAmount, charge.currency)}' was cancelled. Nothing to pay.` +
      (paid > 0 ? ` The ${money(paid, charge.currency)} already paid is now credit on your balance.` : '');
    await this.notify(charge.studentId, schoolId, `charge-cancelled-${chargeId}`, 'Charge cancelled', body, chargeId);
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
      await this.lockBalance(tx, schoolId, studentId);
      if (dto.chargeId) {
        const target = await tx.charge.findUniqueOrThrow({ where: { id: dto.chargeId }, include: { allocations: { select: { amount: true } } } });
        if (target.cancelledAt) throw new ConflictException({ code: 'CHARGE_ALREADY_CANCELLED', message: 'This charge has already been cancelled.' });
        if (target.allocations.reduce((n, a) => n + a.amount, 0) >= target.grossAmount) {
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
      await this.allocate(tx, schoolId, studentId, currency!, transactionId, dto.chargeId ?? null);
    });

    if (dto.sendReceipt !== false) {
      await this.notify(studentId, schoolId, `charge-payment-${transactionId}`, 'Payment received', `Your payment of ${money(dto.amount, currency)} was received.`, transactionId);
    }
    const data = await this.prismaJobs.$transaction((tx) => this.readLedger(tx, schoolId, studentId));
    const view = await this.shapeLedger(data, school.timezone, true);
    return { payment: view.payments.find((p) => p.id === transactionId)!, balances: view.balances };
  }

  // ---------------------------------------------------------------------------
  // The member (or Guardian): the app's Invoices screen
  // ---------------------------------------------------------------------------

  /** GET /students/{id}/charges: the student's charges and receipts at every
   * School, for the student or an active Guardian. Read under the student's
   * own context, as the app's other reads for a child are. */
  async listForMember(callerId: string, studentId: string) {
    this.assertUuid(studentId);
    if (callerId !== studentId) {
      try {
        await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        throw new ForbiddenException('Only the student, or their Guardian, can see their charges.');
      }
    }
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    const schoolIds = (
      await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.balanceEntry.findMany({ where: { studentId, ...(impersonationSchoolId ? { schoolId: impersonationSchoolId } : {}) }, distinct: ['schoolId'], select: { schoolId: true } }),
      )
    ).map((r) => r.schoolId);
    const schools = await this.prismaJobs.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true, taxId: true, timezone: true } });
    const out: Array<{ schoolId: string; schoolName: string; taxId: string | null } & Awaited<ReturnType<ChargesService['shapeLedger']>>> = [];
    for (const school of schools.sort((a, b) => a.name.localeCompare(b.name))) {
      const data = await this.prismaApp.withTenantContext(studentId, (tx) => this.readLedger(tx, school.id, studentId));
      const view = await this.shapeLedger(data, school.timezone, false);
      out.push({ schoolId: school.id, schoolName: school.name, taxId: school.taxId, ...view });
    }
    return { schools: out };
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

  /** One student's balance at one School, one at a time. */
  private async lockBalance(tx: Tx, schoolId: string, studentId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`charge-balance:${schoolId}:${studentId}`}, 0))`;
  }

  /**
   * Puts money that isn't on a charge yet toward open charges in `currency`:
   * `firstChargeId` first, then the oldest due. Money not on a charge is the
   * total paid in minus what is on charges still standing (money on a
   * cancelled charge is free again). Each step is a ChargeAllocation row,
   * marked with the desk payment it came from, or none for credit.
   */
  private async allocate(tx: Tx, schoolId: string, studentId: string, currency: string, transactionId: string | null, firstChargeId: string | null) {
    const [sum, charges] = await Promise.all([
      tx.balanceEntry.aggregate({ where: { schoolId, studentId, currency }, _sum: { amount: true } }),
      tx.charge.findMany({
        where: { schoolId, studentId, currency, cancelledAt: null },
        include: { allocations: { select: { amount: true } } },
        orderBy: [{ dueDate: 'asc' }, { invoiceNumber: 'asc' }],
      }),
    ]);
    const remaining = (c: ChargeRow) => c.grossAmount - c.allocations.reduce((n, a) => n + a.amount, 0);
    const owed = charges.reduce((n, c) => n + Math.max(0, remaining(c)), 0);
    let free = owed - (sum._sum.amount ?? 0);
    const ordered = firstChargeId ? [...charges.filter((c) => c.id === firstChargeId), ...charges.filter((c) => c.id !== firstChargeId)] : charges;
    for (const c of ordered) {
      if (free <= 0) break;
      const take = Math.min(free, remaining(c));
      if (take <= 0) continue;
      await tx.chargeAllocation.create({ data: { id: randomUUID(), schoolId, studentId, chargeId: c.id, amount: take, transactionId } });
      free -= take;
    }
  }

  private async readLedger(tx: Tx, schoolId: string, studentId: string) {
    const [charges, entries, allocations] = await Promise.all([
      tx.charge.findMany({ where: { schoolId, studentId }, include: { allocations: { select: { amount: true } } } }),
      tx.balanceEntry.findMany({ where: { schoolId, studentId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      tx.chargeAllocation.findMany({ where: { schoolId, studentId } }),
    ]);
    return { schoolId, charges, entries, allocations };
  }

  private async shapeLedger(
    data: { schoolId: string; charges: ChargeRow[]; entries: EntryRow[]; allocations: AllocationRow[] },
    timezone: string | null,
    forStaff: boolean,
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
      .map(([currency, b]) => ({ schoolId: data.schoolId, currency, owed: b.owed, credit: Math.max(0, b.owed - b.sum), net: b.sum, overdue: b.overdue }));

    const invoiceOf = new Map(data.charges.map((c) => [c.id, formatInvoiceNumber(c.invoiceNumber)]));
    const recorders = forStaff ? await resolveUserNames(this.prismaAuth, data.entries.map((e) => e.recordedById).filter((id): id is string => !!id)) : new Map();
    const payments = data.entries
      .filter((e) => e.kind === 'PAYMENT')
      .map((e) => {
        const allocations = data.allocations
          .filter((a) => a.transactionId === e.transactionId)
          .map((a) => ({ chargeId: a.chargeId, invoiceLabel: invoiceOf.get(a.chargeId) ?? '', amount: a.amount }));
        const recorder = e.recordedById ? recorders.get(e.recordedById) : undefined;
        return {
          id: e.transactionId!,
          schoolId: e.schoolId,
          amount: -e.amount,
          currency: e.currency,
          paymentMethod: e.paymentMethod as DeskChargePaymentMethod,
          receivedAt: e.createdAt.toISOString(),
          recordedByName: forStaff && recorder ? `${recorder.firstName} ${recorder.surname}`.trim() : null,
          allocations,
          creditAmount: -e.amount - allocations.reduce((n, a) => n + a.amount, 0),
        };
      });
    return { balances, charges, payments };
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
    return rows.map((c) => {
      const paid = c.allocations.reduce((n, a) => n + a.amount, 0);
      const cancelled = !!c.cancelledAt;
      const owed = cancelled ? 0 : Math.max(0, c.grossAmount - paid);
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
      };
    });
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

/** A @db.Date as YYYY-MM-DD. */
function dayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
