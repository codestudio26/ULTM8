import type { Prisma } from '@prisma/client';
import { isMembershipLive } from '../memberships/membership-creation-guard';

/** Membership types that make a student "active" (Decision 317 item 5). */
export const ACTIVE_TYPES = ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] as const;

type Db = {
  roleGrant: Pick<Prisma.TransactionClient['roleGrant'], 'findMany'>;
  membership: Pick<Prisma.TransactionClient['membership'], 'findMany'>;
};

/**
 * Decision 317 item 5 / Decision 374: the School's active students. Enrolled
 * students (an active STUDENT grant) who hold a membership in effect now: a
 * Subscription, a Class Pack with credits left, a Weekly Pass or a Trial
 * (`isMembershipLive`). A Friend Pass or a visit pass doesn't count.
 *
 * The one definition the Dashboard card and Students → Growth both use, so
 * the two numbers always agree. Returns the enrolled students too, since
 * Growth counts Visitors and frozen members among them.
 */
export async function loadActiveStudents(db: Db, schoolId: string, now: Date = new Date()): Promise<{ enrolled: Set<string>; active: Set<string> }> {
  const [grants, memberships] = await Promise.all([
    db.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true } }),
    db.membership.findMany({
      where: { schoolId, status: 'ACTIVE', membershipPlan: { type: { in: [...ACTIVE_TYPES] } } },
      select: { studentId: true, status: true, expiryDate: true, classesRemaining: true },
    }),
  ]);
  const enrolled = new Set(grants.map((g) => g.userId));
  const active = new Set(memberships.filter((m) => enrolled.has(m.studentId) && isMembershipLive(m, now)).map((m) => m.studentId));
  return { enrolled, active };
}
