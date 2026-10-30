import type { PrismaClient } from '@prisma/client';
import { currentFreeze, dayIn, freezeSummary, FreezeSummary, isFrozenOn } from './membership-freeze';

export type FreezeState = { frozen: boolean; freeze: FreezeSummary | null };

/**
 * Each membership's current freeze or request and whether it is frozen today
 * (Decision 404), on the jobs connection, for memberships the caller was
 * already allowed to read. Shared by the owner's Student page, the member's
 * own list and the Students roster.
 */
export async function loadFreezeStates(db: Pick<PrismaClient, 'membershipFreeze'>, membershipIds: string[]): Promise<Map<string, FreezeState>> {
  const out = new Map<string, FreezeState>();
  if (membershipIds.length === 0) return out;
  const rows = await db.membershipFreeze.findMany({
    where: { membershipId: { in: membershipIds }, status: { in: ['REQUESTED', 'APPROVED'] } },
    include: { school: { select: { timezone: true } } },
  });
  const now = new Date();
  const byMembership = new Map<string, typeof rows>();
  for (const r of rows) byMembership.set(r.membershipId, [...(byMembership.get(r.membershipId) ?? []), r]);
  for (const [id, freezes] of byMembership) {
    const zone = freezes[0].school.timezone;
    const today = dayIn(now, zone);
    out.set(id, { frozen: freezes.some((f) => isFrozenOn(f, today, zone)), freeze: freezeSummary(currentFreeze(freezes, today, zone), zone) });
  }
  return out;
}

/**
 * Decision 404: which of these students hold a membership frozen today at
 * this School (the Students list's Frozen badge and filter), and until when
 * (the day they are back). Jobs connection, for students the caller may list.
 */
export async function loadFrozenStudents(
  db: Pick<PrismaClient, 'membershipFreeze'>,
  schoolId: string,
  studentIds: string[],
): Promise<Map<string, { frozenUntil: string }>> {
  const out = new Map<string, { frozenUntil: string }>();
  if (studentIds.length === 0) return out;
  const rows = await db.membershipFreeze.findMany({
    where: { schoolId, studentId: { in: studentIds }, status: 'APPROVED', endsAt: { gt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } },
    include: { school: { select: { timezone: true } } },
  });
  const now = new Date();
  for (const f of rows) {
    const today = dayIn(now, f.school.timezone);
    if (!isFrozenOn(f, today, f.school.timezone)) continue;
    const summary = freezeSummary(f, f.school.timezone)!;
    const prev = out.get(f.studentId);
    if (!prev || summary.endsAt > prev.frozenUntil) out.set(f.studentId, { frozenUntil: summary.endsAt });
  }
  return out;
}
