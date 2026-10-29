import { Prisma } from '@prisma/client';

/**
 * Decision 391 (Decision 315 item 1): Visitors.
 *
 * A visit pass is a free Membership on the School's one hidden VISIT_PASS
 * plan, so booking, check-in, waivers and the expiry sweep treat it like any
 * other membership: while it lasts the Visitor books and checks in free; once
 * it ends they can't, until staff give another pass or they get a membership.
 *
 * Someone is a Visitor while they have had a visit pass and no other
 * membership since their latest one (a Friend Pass doesn't count: it only
 * covers a guest). Getting a membership makes them a member; a member given a
 * visit pass later is a Visitor again.
 */
export const VISIT_PASS_TITLE = 'Visit pass';

export type VisitorStatus = { visitor: boolean; visitPassEndsAt: Date | null };

type MembershipRow = { studentId: string; createdAt: Date; expiryDate: Date | null; membershipPlan: { type: string } };

export function visitorStatuses(rows: MembershipRow[]): Map<string, VisitorStatus> {
  const byStudent = new Map<string, { lastPass: MembershipRow | null; lastOther: Date | null; endsAt: Date | null }>();
  for (const m of rows) {
    const s = byStudent.get(m.studentId) ?? { lastPass: null, lastOther: null, endsAt: null };
    if (m.membershipPlan.type === 'VISIT_PASS') {
      if (!s.lastPass || m.createdAt > s.lastPass.createdAt) s.lastPass = m;
      if (m.expiryDate && (!s.endsAt || m.expiryDate > s.endsAt)) s.endsAt = m.expiryDate;
    } else if (m.membershipPlan.type !== 'FRIEND_PASS') {
      if (!s.lastOther || m.createdAt > s.lastOther) s.lastOther = m.createdAt;
    }
    byStudent.set(m.studentId, s);
  }
  const out = new Map<string, VisitorStatus>();
  for (const [studentId, s] of byStudent) {
    const visitor = s.lastPass !== null && (s.lastOther === null || s.lastOther < s.lastPass.createdAt);
    out.set(studentId, { visitor, visitPassEndsAt: visitor ? s.endsAt : null });
  }
  return out;
}

/** The memberships visitorStatuses needs, for these students at this School. */
export async function loadVisitorStatuses(
  db: { membership: Pick<Prisma.TransactionClient['membership'], 'findMany'> },
  schoolId: string,
  studentIds: string[],
): Promise<Map<string, VisitorStatus>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.membership.findMany({
    where: { schoolId, studentId: { in: studentIds } },
    select: { studentId: true, createdAt: true, expiryDate: true, membershipPlan: { select: { type: true } } },
  });
  return visitorStatuses(rows);
}
