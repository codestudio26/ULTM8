import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';

/**
 * Decision 315 item 4 (backlog 5.1): a student's join date at a School.
 * Defaults to the day they are added (a trigger on RoleGrant makes it, see
 * migration 20270123000000_member_details); staff can set an earlier day,
 * never a future one. "Today" is the School's own calendar day (its timezone,
 * UTC when it has none), as the trigger uses. StudentJoinDate is read and
 * written only on the jobs connection: callers check access first.
 */

export const JOIN_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!JOIN_DATE_FORMAT.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Today in the School's own calendar, YYYY-MM-DD. */
export async function schoolToday(prismaJobs: PrismaJobsService, schoolId: string): Promise<string> {
  const [row] = await prismaJobs.$queryRaw<Array<{ d: string }>>`
    SELECT "school_local_date"(${schoolId}, (now() AT TIME ZONE 'UTC')::timestamp)::text AS d`;
  return row.d;
}

/** 400 unless `joinedOn` is a real date no later than the School's today. */
export async function assertJoinDateAllowed(prismaJobs: PrismaJobsService, schoolId: string, joinedOn: string): Promise<void> {
  if (!isCalendarDate(joinedOn)) {
    throw new BadRequestException('Enter a real join date (YYYY-MM-DD).');
  }
  if (joinedOn > (await schoolToday(prismaJobs, schoolId))) {
    throw new BadRequestException("The join date can't be in the future.");
  }
}

/** Sets a student's join date at a School (already checked). */
export async function setJoinDate(prismaJobs: PrismaJobsService, schoolId: string, studentId: string, joinedOn: string, setById: string | null): Promise<void> {
  const day = new Date(`${joinedOn}T00:00:00Z`);
  await prismaJobs.studentJoinDate.upsert({
    where: { schoolId_studentId: { schoolId, studentId } },
    create: { id: randomUUID(), schoolId, studentId, joinedOn: day, setById },
    update: { joinedOn: day, setById },
  });
}

/** The join dates (YYYY-MM-DD) of these students at the School. */
export async function loadJoinDates(prismaJobs: PrismaJobsService, schoolId: string, studentIds: string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const rows = await prismaJobs.studentJoinDate.findMany({
    where: { schoolId, studentId: { in: studentIds } },
    select: { studentId: true, joinedOn: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.joinedOn.toISOString().slice(0, 10)]));
}
