import { ForbiddenException } from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';

/**
 * The Dashboard's "Check-ins today" (StaffAttendanceService.today, Decision
 * 454 item 8): which day "today" is on the School's clock, who is counted, and
 * whose Branches. The same rows against a real Postgres, with RLS and another
 * School beside it, are in test/dashboard-tiles.e2e-spec.ts.
 */
describe('StaffAttendanceService.today (Check-ins today)', () => {
  type Where = Record<string, unknown>;

  function make(opts: { timezone: string | null; branchIds: string[] | null; members?: Array<{ classId: string }>; guests?: Array<{ classId: string }> }) {
    const prismaJobs = {
      school: { findUnique: jest.fn().mockResolvedValue({ timezone: opts.timezone }) },
      booking: { findMany: jest.fn().mockResolvedValue((opts.members ?? []).map((m, i) => ({ studentId: `s${i}`, classId: m.classId, checkInMethod: 'INSTRUCTOR_MANUAL' }))) },
      bookingAttendee: { findMany: jest.fn().mockResolvedValue((opts.guests ?? []).map((g) => ({ booking: { classId: g.classId } }))) },
    };
    const tenantAuth = {
      attendanceStatsScope: jest.fn().mockResolvedValue({ isOwner: opts.branchIds === null, branchIds: opts.branchIds }),
      assertBranchBelongsToSchool: jest.fn().mockResolvedValue(undefined),
    };
    const service = new StaffAttendanceService(
      {} as never,
      prismaJobs as never,
      tenantAuth as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prismaJobs, tenantAuth };
  }

  const memberWhere = (p: ReturnType<typeof make>['prismaJobs']) => (p.booking.findMany.mock.calls[0][0] as { where: Where }).where;
  const guestWhere = (p: ReturnType<typeof make>['prismaJobs']) => (p.bookingAttendee.findMany.mock.calls[0][0] as { where: Where }).where;

  afterEach(() => jest.useRealTimers());

  it("counts the classes that start on today's date in the School's time zone, not UTC's", async () => {
    // 23:30 UTC on 12 Nov is already 13 Nov in Auckland (UTC+13 in November).
    jest.useFakeTimers({ now: new Date('2026-11-12T23:30:00Z') });
    const t = make({ timezone: 'Pacific/Auckland', branchIds: null });
    const res = await t.service.today('owner', 'school', {});
    expect(res).toMatchObject({ date: '2026-11-13', timeZone: 'Pacific/Auckland' });
    expect(memberWhere(t.prismaJobs)).toMatchObject({
      schoolId: 'school',
      status: 'COMPLETED',
      class: { startDate: { gte: new Date('2026-11-12T11:00:00Z'), lt: new Date('2026-11-13T11:00:00Z') } },
    });
  });

  it('a School with no time zone counts the UTC day', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T23:30:00Z') });
    const t = make({ timezone: null, branchIds: null });
    const res = await t.service.today('owner', 'school', {});
    expect(res).toMatchObject({ date: '2026-11-12', timeZone: 'UTC' });
    expect(memberWhere(t.prismaJobs)).toMatchObject({ class: { startDate: { gte: new Date('2026-11-12T00:00:00Z'), lt: new Date('2026-11-13T00:00:00Z') } } });
  });

  it("checked-in members and checked-in guests both count, and classes are the ones with a check-in; passes aren't left out", async () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T12:00:00Z') });
    const t = make({ timezone: 'UTC', branchIds: null, members: [{ classId: 'c1' }, { classId: 'c1' }, { classId: 'c2' }], guests: [{ classId: 'c3' }] });
    expect(await t.service.today('owner', 'school', {})).toEqual({ date: '2026-11-12', timeZone: 'UTC', branchIds: null, checkIns: 4, classes: 3 });
    expect(memberWhere(t.prismaJobs)).not.toHaveProperty('OR');
    expect(guestWhere(t.prismaJobs)).toMatchObject({ schoolId: 'school', checkedInAt: { not: null }, booking: { status: 'COMPLETED' } });
  });

  it('nothing checked in today is 0 check-ins in 0 classes', async () => {
    const t = make({ timezone: 'UTC', branchIds: null });
    expect(await t.service.today('owner', 'school', {})).toMatchObject({ checkIns: 0, classes: 0 });
  });

  it("Branch Staff are counted over their own Branches only, and can't name another", async () => {
    const t = make({ timezone: 'UTC', branchIds: ['north'] });
    expect(await t.service.today('staff', 'school', {})).toMatchObject({ branchIds: ['north'] });
    expect(memberWhere(t.prismaJobs)).toMatchObject({ branchId: { in: ['north'] } });
    expect(guestWhere(t.prismaJobs)).toMatchObject({ booking: { branchId: { in: ['north'] } } });

    await expect(t.service.today('staff', 'school', { branchId: 'south' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.prismaJobs.booking.findMany).toHaveBeenCalledTimes(1);
  });

  it("the owner's Branch filter narrows to that Branch, after checking it is the School's", async () => {
    const t = make({ timezone: 'UTC', branchIds: null });
    expect(await t.service.today('owner', 'school', { branchId: 'south' })).toMatchObject({ branchIds: ['south'] });
    expect(t.tenantAuth.assertBranchBelongsToSchool).toHaveBeenCalledWith('owner', 'south', 'school');
    expect(memberWhere(t.prismaJobs)).toMatchObject({ branchId: { in: ['south'] } });
  });

  it('whoever may not see attendance statistics is refused before anything is read', async () => {
    const t = make({ timezone: 'UTC', branchIds: null });
    t.tenantAuth.attendanceStatsScope.mockRejectedValue(new ForbiddenException());
    await expect(t.service.today('coach', 'school', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.prismaJobs.booking.findMany).not.toHaveBeenCalled();
    expect(t.prismaJobs.school.findUnique).not.toHaveBeenCalled();
  });
});
