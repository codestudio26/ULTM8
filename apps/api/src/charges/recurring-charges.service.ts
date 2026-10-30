import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RecurringCharge } from '@prisma/client';
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
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { ChargesService } from './charges.service';
import { ChargeMathsError, ChargeTotals, computeCharge } from './charge-maths';
import { InvoiceNotice, runSeries, seriesState } from './recurring-occurrences';
import { dayOf, dayValue, firstIndexOnOrAfter, nextDay, schoolToday, type RecurringFrequency } from './recurring-schedule';
import { CreateRecurringChargeDto, RecurringChargeStatus } from './dto/recurring-charge.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same repeat guard as a charge or desk sale (DESK_REPEAT). */
const DESK_REPEAT_WINDOW_MS = 60_000;

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
const EVERY: Record<RecurringFrequency, string> = { WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };

type SchoolTax = { taxRateBasisPoints: number; taxInclusive: boolean };

const STATUS_ORDER: Record<RecurringChargeStatus, number> = { ACTIVE: 0, STOPPED: 1, ENDED: 2 };

/**
 * Recurring charges outside a Membership Plan, step 3 of 6 of v1.3 backlog
 * §3.6 (Decision 303 item 1, Decision 338 item 2, Decision 412).
 *
 * Staff who can create charges set one up on the student's page: description,
 * price, optional discount, weekly, monthly or yearly, a first date, and
 * optionally an end date or a number of payments. Each occurrence becomes a
 * normal charge on its day (recurring-occurrences.ts, made by the daily
 * charge-recurring job, or straight away when the first date is today).
 *
 * Who (Decision 412, Decision 338 item 2):
 * - set up and stop: the owner, and staff who cover the student and have
 *   "Can create charges" (ChargesService.abilities().create);
 * - restart a stopped one: the owner, and staff with access to payments:
 *   Branch Staff who cover the student when the School lets Branch Staff
 *   record payments (Decision 347's switch, as step 1's desk payments).
 *
 * Editing a running series is not built: stop it and set up a new one.
 */
@Injectable()
export class RecurringChargesService {
  private readonly logger = new Logger(RecurringChargesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly guardiansService: GuardiansService,
    private readonly charges: ChargesService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Who may do what
  // ---------------------------------------------------------------------------

  private async may(callerId: string, schoolId: string, studentId: string) {
    this.assertUuid(studentId);
    const can = await this.charges.abilities(callerId, schoolId, studentId);
    return { read: can.create || can.cancel || can.recordPayment, create: can.create, stop: can.create, restart: can.recordPayment };
  }

  private async assertMay(callerId: string, schoolId: string, studentId: string, what: 'read' | 'create' | 'stop' | 'restart') {
    const can = await this.may(callerId, schoolId, studentId);
    if (can[what]) return can;
    const message = {
      read: "The School owner hasn't let you see this student's charges.",
      create: "The School owner hasn't let you create charges.",
      stop: "The School owner hasn't let you stop recurring charges.",
      restart: 'Only the School owner, and staff who can take payments, can restart a recurring charge.',
    }[what];
    throw new ForbiddenException({ code: 'STAFF_ACCESS_OFF', message });
  }

  // ---------------------------------------------------------------------------
  // Staff: the student's Payments card
  // ---------------------------------------------------------------------------

  /** GET /schools/{schoolId}/students/{studentId}/recurring-charges. Read
   * under the caller's own context, as the student's charges are. */
  async listForStaff(callerId: string, schoolId: string, studentId: string) {
    const can = await this.assertMay(callerId, schoolId, studentId, 'read');
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) => tx.recurringCharge.findMany({ where: { schoolId, studentId } }));
    const tax = await this.loadTax(schoolId);
    const items = await this.shape(rows, new Map([[schoolId, tax]]), true);
    return { items, can: { create: can.create, stop: can.stop, restart: can.restart } };
  }

  /** POST /schools/{schoolId}/students/{studentId}/recurring-charges (Decision 412). */
  async create(callerId: string, schoolId: string, studentId: string, dto: CreateRecurringChargeDto) {
    await this.assertMay(callerId, schoolId, studentId, 'create');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    await this.assertCurrentStudent(schoolId, studentId);
    const school = await this.prismaJobs.school.findUnique({
      where: { id: schoolId },
      select: { defaultCurrency: true, timezone: true, taxRateBasisPoints: true, taxInclusive: true },
    });
    if (!school) throw new NotFoundException('School not found');
    const currency = school.defaultCurrency?.toUpperCase();
    if (!currency) {
      throw new BadRequestException({ code: 'CHARGE_NO_CURRENCY', message: "Set the School's currency on the School page before creating charges." });
    }
    if (!!dto.discountType !== (dto.discountValue !== null && dto.discountValue !== undefined)) {
      throw new BadRequestException({ code: 'CHARGE_DISCOUNT_INVALID', message: 'A discount must be more than 0.' });
    }
    // The same checks as a single charge: the discount must leave something to pay.
    const estimate = this.estimate({ unitAmount: dto.amount, discountType: dto.discountType ?? null, discountValue: dto.discountValue ?? null }, school);

    const today = schoolToday(new Date(), school.timezone);
    if (dto.firstDate < today) {
      throw new BadRequestException({ code: 'RECURRING_CHARGE_FIRST_DATE_PAST', message: "The first date can't be in the past." });
    }
    const endDate = dto.endDate ?? null;
    const maxOccurrences = dto.maxOccurrences ?? null;
    if (endDate !== null && maxOccurrences !== null) {
      throw new BadRequestException({ code: 'RECURRING_CHARGE_END_BOTH', message: 'Choose an end date or a number of payments, not both.' });
    }
    if (endDate !== null && endDate < dto.firstDate) {
      throw new BadRequestException({ code: 'RECURRING_CHARGE_END_BEFORE_FIRST', message: 'The end date must be on or after the first date.' });
    }

    const id = randomUUID();
    await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`recurring-charge-create:${schoolId}:${studentId}`}, 0))`;
      const recent = await tx.recurringCharge.findFirst({
        where: { schoolId, studentId, description: dto.description, unitAmount: dto.amount, frequency: dto.frequency, createdById: callerId, createdAt: { gt: new Date(Date.now() - DESK_REPEAT_WINDOW_MS) } },
        select: { id: true },
      });
      if (recent) throw new ConflictException({ code: 'DESK_REPEAT', message: 'This was just recorded. Check before adding another.' });
      await tx.recurringCharge.create({
        data: {
          id,
          schoolId,
          studentId,
          description: dto.description,
          unitAmount: dto.amount,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountType ? dto.discountValue! : null,
          currency,
          frequency: dto.frequency,
          firstDate: dayValue(dto.firstDate),
          endDate: endDate ? dayValue(endDate) : null,
          maxOccurrences,
          nextDate: dayValue(dto.firstDate),
          createdById: callerId,
        },
      });
    });

    await this.notify(
      studentId,
      schoolId,
      `recurring-charge-set-up-${id}`,
      'Recurring charge set up',
      `A recurring charge was set up: ${dto.description}, ${money(estimate.grossAmount, currency)} every ${EVERY[dto.frequency]}, first on ${dto.firstDate}.`,
      id,
    );
    // A first date of today: its charge is made now, not at the next run.
    await this.runNow(id);
    return this.readOne(callerId, schoolId, id);
  }

  /** POST /schools/{schoolId}/recurring-charges/{id}/stop. No more charges are
   * made; those already made stay (staff cancel them one by one if needed). */
  async stop(callerId: string, schoolId: string, id: string) {
    const series = await this.findSeries(schoolId, id);
    await this.assertMay(callerId, schoolId, series.studentId, 'stop');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const stoppedAt = new Date();
    await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await tx.$queryRaw`SELECT id FROM "RecurringCharge" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.recurringCharge.findUniqueOrThrow({ where: { id } });
      if (row.stoppedAt) throw new ConflictException({ code: 'RECURRING_CHARGE_ALREADY_STOPPED', message: 'This recurring charge is already stopped.' });
      if (!row.nextDate) throw this.ended();
      await tx.recurringCharge.update({ where: { id }, data: { stoppedAt, stoppedById: callerId, stoppedReason: 'STAFF' } });
    });
    await this.notify(
      series.studentId,
      schoolId,
      `recurring-charge-stopped-${id}-${stoppedAt.getTime()}`,
      'Recurring charge stopped',
      `Your recurring charge '${series.description}' was stopped. No more invoices will be created for it.`,
      id,
    );
    return this.readOne(callerId, schoolId, id);
  }

  /**
   * POST /schools/{schoolId}/recurring-charges/{id}/restart (Decision 338 item
   * 2). It picks up at its first occurrence on or after today: the ones that
   * fell while it was stopped are not charged. Refused once the series has
   * ended, or for a student who is no longer a current student.
   */
  async restart(callerId: string, schoolId: string, id: string) {
    const series = await this.findSeries(schoolId, id);
    await this.assertMay(callerId, schoolId, series.studentId, 'restart');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);
    await this.assertCurrentStudent(schoolId, series.studentId);
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
    const now = new Date();
    const today = schoolToday(now, school.timezone);
    const restartedNext = await this.prismaJobs.$transaction(async (tx) => {
      await lockSchoolOpen(tx, schoolId);
      await tx.$queryRaw`SELECT id FROM "RecurringCharge" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.recurringCharge.findUniqueOrThrow({ where: { id } });
      if (!row.stoppedAt) {
        if (!row.nextDate) throw this.ended();
        throw new ConflictException({ code: 'RECURRING_CHARGE_NOT_STOPPED', message: "This recurring charge isn't stopped." });
      }
      const state = seriesState(row);
      const nextIndex = firstIndexOnOrAfter(state.firstDate, state.frequency, today, row.nextIndex);
      const next = nextDay({ ...state, nextIndex });
      if (!next) throw this.ended();
      await tx.recurringCharge.update({
        where: { id },
        data: { stoppedAt: null, stoppedById: null, stoppedReason: null, restartedAt: now, restartedById: callerId, nextIndex, nextDate: dayValue(next) },
      });
      return next;
    });
    await this.notify(
      series.studentId,
      schoolId,
      `recurring-charge-restarted-${id}-${now.getTime()}`,
      'Recurring charge restarted',
      `Your recurring charge '${series.description}' was restarted. The next invoice is on ${restartedNext}.`,
      id,
    );
    await this.runNow(id);
    return this.readOne(callerId, schoolId, id);
  }

  // ---------------------------------------------------------------------------
  // The member (or Guardian): read-only, on the app's Payments screen
  // ---------------------------------------------------------------------------

  /** GET /students/{id}/recurring-charges: the student's recurring charges at
   * every School, for the student or an active Guardian. Read under the
   * student's own context, as their charges are. */
  async listForMember(callerId: string, studentId: string) {
    await this.assertMemberOrGuardian(callerId, studentId);
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    const rows = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.recurringCharge.findMany({ where: { studentId, ...(impersonationSchoolId ? { schoolId: impersonationSchoolId } : {}) } }),
    );
    const schools = await this.prismaJobs.school.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.schoolId))] } },
      select: { id: true, name: true, taxRateBasisPoints: true, taxInclusive: true },
    });
    const byId = new Map(schools.map((s) => [s.id, s]));
    const items = await this.shape(rows, new Map(schools.map((s) => [s.id, s])), false);
    return {
      items: items
        .map((i) => ({ ...i, schoolName: byId.get(i.schoolId)?.name ?? '' }))
        .sort((a, b) => a.schoolName.localeCompare(b.schoolName) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Makes any occurrence due today now. Best-effort: the daily job makes it
   * otherwise, so a failure here never fails the request. */
  private async runNow(id: string) {
    let created: InvoiceNotice[];
    try {
      created = (await runSeries(this.prismaJobs, id, new Date())).created;
    } catch (err) {
      this.logger.warn(`Recurring charge ${id}: making today's charge failed; the daily job makes it. ${err}`);
      return;
    }
    const series = await this.prismaJobs.recurringCharge.findUniqueOrThrow({ where: { id }, select: { studentId: true, schoolId: true } });
    for (const n of created) await this.notify(series.studentId, series.schoolId, n.key, n.title, n.body, n.targetId);
  }

  private async readOne(callerId: string, schoolId: string, id: string) {
    const row = await this.prismaJobs.recurringCharge.findUniqueOrThrow({ where: { id } });
    const [item] = await this.shape([row], new Map([[schoolId, await this.loadTax(schoolId)]]), true);
    return item;
  }

  private async findSeries(schoolId: string, id: string) {
    this.assertUuid(id);
    const series = await this.prismaJobs.recurringCharge.findFirst({ where: { id, schoolId }, select: { studentId: true, description: true } });
    if (!series) throw new NotFoundException({ code: 'RECURRING_CHARGE_NOT_FOUND', message: 'Recurring charge not found' });
    return series;
  }

  private async assertCurrentStudent(schoolId: string, studentId: string) {
    const current = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!current) {
      throw new BadRequestException({ code: 'CHARGE_NOT_A_STUDENT', message: 'Charges can only be created for a current student of this School.' });
    }
  }

  private ended() {
    return new ConflictException({ code: 'RECURRING_CHARGE_ENDED', message: 'This recurring charge has ended: its end date has passed or all its payments were made.' });
  }

  private async loadTax(schoolId: string): Promise<SchoolTax> {
    return this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { taxRateBasisPoints: true, taxInclusive: true } });
  }

  /** What each charge would be at the School's tax today (each charge uses the rate on its own day). */
  private estimate(r: { unitAmount: number; discountType: 'PERCENT' | 'FIXED' | null; discountValue: number | null }, tax: SchoolTax): ChargeTotals & { taxRateBasisPoints: number } {
    try {
      const totals = computeCharge({
        unitAmount: r.unitAmount,
        discount: r.discountType ? { type: r.discountType, value: r.discountValue! } : null,
        taxRateBasisPoints: tax.taxRateBasisPoints,
        taxInclusive: tax.taxInclusive,
      });
      return { ...totals, taxRateBasisPoints: tax.taxRateBasisPoints };
    } catch (err) {
      if (err instanceof ChargeMathsError) throw new BadRequestException({ code: `CHARGE_${err.code}`, message: err.message });
      throw err;
    }
  }

  private async shape(rows: RecurringCharge[], taxes: Map<string, SchoolTax>, forStaff: boolean) {
    const names = forStaff
      ? await resolveUserNames(this.prismaAuth, rows.flatMap((r) => [r.createdById, r.stoppedById]).filter((id): id is string => !!id))
      : new Map();
    const nameOf = (id: string | null) => {
      const n = forStaff && id ? names.get(id) : undefined;
      return n ? `${n.firstName} ${n.surname}`.trim() : null;
    };
    const items = rows.map((r) => {
      const status: RecurringChargeStatus = r.stoppedAt ? 'STOPPED' : r.nextDate ? 'ACTIVE' : 'ENDED';
      const e = this.estimate(r, taxes.get(r.schoolId) ?? { taxRateBasisPoints: 0, taxInclusive: true });
      return {
        id: r.id,
        schoolId: r.schoolId,
        studentId: r.studentId,
        description: r.description,
        unitAmount: r.unitAmount,
        discountType: r.discountType,
        discountValue: r.discountValue,
        currency: r.currency,
        frequency: r.frequency,
        firstDate: dayOf(r.firstDate),
        endDate: r.endDate ? dayOf(r.endDate) : null,
        maxOccurrences: r.maxOccurrences,
        createdCount: r.createdCount,
        nextDate: status === 'ACTIVE' && r.nextDate ? dayOf(r.nextDate) : null,
        status,
        stoppedAt: r.stoppedAt?.toISOString() ?? null,
        stoppedReason: r.stoppedReason,
        stoppedByName: nameOf(r.stoppedById),
        createdByName: nameOf(r.createdById),
        createdAt: r.createdAt.toISOString(),
        estimate: { netAmount: e.netAmount, taxAmount: e.taxAmount, grossAmount: e.grossAmount, taxRateBasisPoints: e.taxRateBasisPoints },
      };
    });
    return items.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.status === 'ACTIVE' ? (a.nextDate ?? '').localeCompare(b.nextDate ?? '') : b.createdAt.localeCompare(a.createdAt)),
    );
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

  /** The member's notice; a Guardian gets a copy from the fanout job.
   * Best-effort, as ChargesService.notify(). */
  private async notify(studentId: string, schoolId: string, key: string, title: string, body: string, targetId: string) {
    try {
      await this.fanoutQueue.add(
        'notify',
        { notificationId: key, userId: studentId, title, body, type: 'CHARGE', schoolId, targetType: 'PAYMENT', targetId } satisfies NotificationFanoutJobData,
        { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue the recurring charge notice ${key}: ${err}`);
    }
  }

  private assertUuid(id: string) {
    if (!UUID_PATTERN.test(id)) throw new BadRequestException('id must be a valid UUID');
  }
}
