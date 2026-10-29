import type { PrismaClient } from '@prisma/client';
import { dayIn, dayNumber, dayToDate, isFrozenOn } from './membership-freeze';

type Db = Pick<PrismaClient, 'membershipFreeze' | 'school'>;

/** Decision 404: what booking and check-in say when the membership is frozen. */
export const MEMBERSHIP_FROZEN = {
  code: 'MEMBERSHIP_FROZEN',
  message: 'This membership is frozen, so it can\'t be used to book or check in until the freeze ends.',
} as const;

/**
 * Which of these memberships an approved freeze covers on any of these
 * moments (each read as a day in the School's time zone). Read on the jobs
 * connection: MembershipFreeze has no request-context policy, and booking and
 * check-in run in the member's own context. Called after the caller's own
 * checks, for memberships the caller already read.
 */
export async function frozenMembershipIds(db: Db, schoolId: string, membershipIds: string[], moments: Date[]): Promise<Set<string>> {
  if (membershipIds.length === 0 || moments.length === 0) return new Set();
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  const zone = school?.timezone ?? null;
  const days = moments.map((m) => dayIn(m, zone));
  const nums = days.map(dayNumber);
  const freezes = await db.membershipFreeze.findMany({
    where: {
      membershipId: { in: membershipIds },
      status: 'APPROVED',
      startsAt: { lte: dayToDate(days[nums.indexOf(Math.max(...nums))]) },
      endsAt: { gt: dayToDate(days[nums.indexOf(Math.min(...nums))]) },
    },
    select: { membershipId: true, status: true, startsAt: true, endsAt: true, endedEarlyAt: true },
  });
  const frozen = new Set<string>();
  for (const f of freezes) {
    if (days.some((d) => isFrozenOn(f, d, zone))) frozen.add(f.membershipId);
  }
  return frozen;
}
