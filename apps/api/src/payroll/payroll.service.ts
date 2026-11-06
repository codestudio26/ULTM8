import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { localDateRangeToInstants, safeZone } from '../bookings/booking-week';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { requireSchoolCurrency, setsNewPrice } from '../common/school-currency';
import { localDay } from '../ranks/engine';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { PayRatesResponseDto, PayrollReportQueryDto, PayrollReportResponseDto, SetPayRateDto } from './dto/payroll.dto';
import { MAX_PAYROLL_RANGE_DAYS, classMinutes, payFor, presetRange, rangeDays } from './payroll-maths';

const STAFF_ROLES: Role[] = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'];
/** Existing, translated messages. */
const NOT_STAFF = 'This person is not on the staff of this School.';
const FROM_AFTER_TO = 'from must not be after to.';

/** A day each side of the range, in UTC: every class whose local date (in
 * any zone) falls in the range starts inside this window. */
const ZONE_SLACK_MS = 26 * 3_600_000;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * The payroll report (Decision 320 item 4). Each staff member can have an
 * hourly rate and a per-class rate in the School's currency; the report adds
 * up, per person, hours × the hourly rate plus classes taught × the per-class
 * rate, over a date range. A person with both rates blank is left out.
 * ULTM8 never pays anyone: this is a report only.
 *
 * What counts as a class taught:
 * - a Class at the School whose coach (Class.instructorId) is the person:
 *   the coach on that single class, so changing the coach of one class
 *   (a substitute) pays the substitute, not the timetable's usual coach;
 * - that has ended (a class still to come hasn't been taught);
 * - that wasn't cancelled (Class.cancelledAt);
 * - whose start falls in the range, as a local date in its Branch's time
 *   zone, else the School's.
 * Hours are the class's length, start to end. There is no clock in or out.
 *
 * Who: the report is for the School's owners, and Branch Staff the owner
 * switched on ("Payroll", Decision 435 item 22), for the whole School: every
 * staff member and every Branch's classes. Checked by assertMayRunPayroll.
 * The switch gives the report only: the Rates tab (listing and setting the
 * rates) stays the School's owners' alone, as before it, so nobody switched
 * on can change their own rate or anyone else's. Whether the report shows
 * them the rates (read only) is the owner's choice, School.payrollStaffSeeRates
 * (off by default): off, the rows carry classes, hours and pay, and no rate. The rates are read and
 * written on the app connection, whose RLS policy lets the School's owners
 * read and write them and those Branch Staff only read them
 * (is_payroll_staff). What the report adds up around them (who is on the
 * staff, the School's names for them, the Branches and the classes taught)
 * is read on the jobs connection for this School only, after that check: a
 * Branch Staff member's own view stops at their Branches.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** Everyone on the staff, with their rates, and anyone who left but still
   * has a rate (so it can be cleared). */
  async listRates(callerId: string, schoolId: string): Promise<PayRatesResponseDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { school, grants, rates, permissions } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const [school, grants, rates, permissions] = await Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { defaultCurrency: true } }),
        tx.roleGrant.findMany({ where: { schoolId, role: { in: STAFF_ROLES }, revokedAt: null }, select: { userId: true, role: true } }),
        tx.staffPayRate.findMany({ where: { schoolId }, select: { userId: true, hourlyRate: true, perClassRate: true } }),
        tx.staffPermission.findMany({ where: { schoolId }, select: { userId: true, displayName: true } }),
      ]);
      return { school, grants, rates, permissions };
    });
    const roles = new Map<string, Set<string>>();
    for (const g of grants) roles.set(g.userId, (roles.get(g.userId) ?? new Set()).add(g.role));
    const rateOf = new Map(rates.map((r) => [r.userId, r]));
    const ids = [...new Set([...roles.keys(), ...rateOf.keys()])];
    const names = await this.names(ids, permissions);
    return {
      currency: school?.defaultCurrency?.trim().toUpperCase() || null,
      items: ids
        .map((userId) => ({
          userId,
          name: names.get(userId) ?? '',
          roles: STAFF_ROLES.filter((r) => roles.get(userId)?.has(r)),
          hourlyRate: rateOf.get(userId)?.hourlyRate ?? null,
          perClassRate: rateOf.get(userId)?.perClassRate ?? null,
        }))
        .sort(byName),
    };
  }

  /** Sets both rates. Only a current member of staff can be given a rate;
   * clearing both removes the person from payroll, on or off the staff. */
  async setRate(callerId: string, schoolId: string, userId: string, dto: SetPayRateDto): Promise<PayRatesResponseDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const existing = await tx.staffPayRate.findUnique({ where: { schoolId_userId: { schoolId, userId } }, select: { hourlyRate: true, perClassRate: true } });
      if (dto.hourlyRate === null && dto.perClassRate === null) {
        if (existing) await tx.staffPayRate.delete({ where: { schoolId_userId: { schoolId, userId } } });
        return;
      }
      const onStaff = await tx.roleGrant.findFirst({ where: { schoolId, userId, role: { in: STAFF_ROLES }, revokedAt: null }, select: { id: true } });
      if (!onStaff) throw new NotFoundException(NOT_STAFF);
      // Decision 414 item 6: a new non-zero amount needs the School's currency.
      if (setsNewPrice(dto.hourlyRate, existing?.hourlyRate) || setsNewPrice(dto.perClassRate, existing?.perClassRate)) {
        const school = await tx.school.findUnique({ where: { id: schoolId }, select: { defaultCurrency: true } });
        requireSchoolCurrency(school?.defaultCurrency);
      }
      const data = { hourlyRate: dto.hourlyRate, perClassRate: dto.perClassRate, updatedById: callerId };
      await tx.staffPayRate.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, ...data },
        update: data,
      });
    });
    return this.listRates(callerId, schoolId);
  }

  async report(callerId: string, schoolId: string, query: PayrollReportQueryDto, now = new Date()): Promise<PayrollReportResponseDto> {
    const { isOwner } = await this.tenantAuth.assertMayRunPayroll(callerId, schoolId);
    const rates = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.staffPayRate.findMany({ where: { schoolId }, select: { userId: true, hourlyRate: true, perClassRate: true } }),
    );
    // The rest of the report: this School only, after the check above.
    const db = this.prismaJobs;
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { defaultCurrency: true, timezone: true, payrollStaffSeeRates: true } });
    // The owners always see the rates; switched-on staff only when the School
    // says so (off by default). Pay is still worked out from them.
    const ratesShown = isOwner || school?.payrollStaffSeeRates === true;
    const schoolZone = safeZone(school?.timezone);
    const preset = query.preset ?? 'LAST_30_DAYS';
    const range = preset === 'CUSTOM' ? { from: query.from as string, to: query.to as string } : presetRange(preset, now, schoolZone);
    if (range.from > range.to) throw new BadRequestException(FROM_AFTER_TO);
    // Checks both dates are real ones.
    const { gte, lt } = localDateRangeToInstants(range.from, range.to, schoolZone);
    if (rangeDays(range.from, range.to) > MAX_PAYROLL_RANGE_DAYS) {
      throw new BadRequestException(`The date range can be at most ${MAX_PAYROLL_RANGE_DAYS} days.`);
    }

    const [grants, permissions, branches] = await Promise.all([
      db.roleGrant.findMany({ where: { schoolId, role: { in: STAFF_ROLES }, revokedAt: null }, select: { userId: true } }),
      db.staffPermission.findMany({ where: { schoolId }, select: { userId: true, displayName: true } }),
      db.branch.findMany({ where: { schoolId }, select: { id: true, timezone: true } }),
    ]);
    const totals = new Map(rates.map((r) => [r.userId, { classes: 0, minutes: 0 }]));
    if (rates.length > 0) {
      const classes = await db.class.findMany({
        where: {
          schoolId,
          instructorId: { in: rates.map((r) => r.userId) },
          cancelledAt: null,
          startDate: { gte: new Date(gte.getTime() - ZONE_SLACK_MS), lt: new Date(lt.getTime() + ZONE_SLACK_MS) },
          endDate: { lte: now },
        },
        select: { instructorId: true, branchId: true, startDate: true, endDate: true },
      });
      const zoneOf = new Map(branches.map((b) => [b.id, b.timezone ? safeZone(b.timezone) : schoolZone]));
      for (const c of classes) {
        const day = localDay(c.startDate, (c.branchId && zoneOf.get(c.branchId)) || schoolZone);
        if (day < range.from || day > range.to) continue;
        const t = totals.get(c.instructorId as string);
        if (!t) continue;
        t.classes += 1;
        t.minutes += classMinutes(c.startDate, c.endDate);
      }
    }

    const onStaff = new Set(grants.map((g) => g.userId));
    const names = await this.names(rates.map((r) => r.userId), permissions);
    const rows = rates
      .map((r) => {
        const t = totals.get(r.userId) ?? { classes: 0, minutes: 0 };
        return {
          userId: r.userId,
          name: names.get(r.userId) ?? '',
          onStaff: onStaff.has(r.userId),
          hourlyRate: ratesShown ? r.hourlyRate : null,
          perClassRate: ratesShown ? r.perClassRate : null,
          classesTaught: t.classes,
          minutesTaught: t.minutes,
          pay: payFor(t.minutes, t.classes, r.hourlyRate, r.perClassRate),
        };
      })
      .sort(byName);
    return {
      preset,
      from: range.from,
      to: range.to,
      currency: school?.defaultCurrency?.trim().toUpperCase() || null,
      ratesShown,
      rows,
      totalClasses: rows.reduce((s, r) => s + r.classesTaught, 0),
      totalMinutes: rows.reduce((s, r) => s + r.minutesTaught, 0),
      totalPay: rows.reduce((s, r) => s + r.pay, 0),
    };
  }

  /** The School's name for each person (Decision 381), else their account's. */
  private async names(userIds: string[], permissions: Array<{ userId: string; displayName: string | null }>): Promise<Map<string, string>> {
    const display = new Map(permissions.filter((p) => p.displayName).map((p) => [p.userId, p.displayName as string]));
    const users = await resolveUserNames(this.prismaAuth, userIds);
    return new Map(userIds.map((id) => [id, display.get(id) ?? `${users.get(id)?.firstName ?? ''} ${users.get(id)?.surname ?? ''}`.trim()]));
  }
}
