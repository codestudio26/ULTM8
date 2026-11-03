import type { Prisma } from '@prisma/client';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { frozenMembershipIds } from '../memberships/freeze/frozen-lookup';

/** Membership types that make a student "active" (Decision 317 item 5). */
export const ACTIVE_TYPES = ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] as const;

type Db = {
  roleGrant: Pick<Prisma.TransactionClient['roleGrant'], 'findMany'>;
  membership: Pick<Prisma.TransactionClient['membership'], 'findMany'>;
};

/** The jobs connection: MembershipFreeze has no request-context policy. */
type FreezeDb = Parameters<typeof frozenMembershipIds>[0];

/**
 * Decision 317 item 5 / Decision 374: the School's active students. Enrolled
 * students (an active STUDENT grant) who hold a membership in effect now: a
 * Subscription, a Class Pack with credits left, a Weekly Pass or a Trial
 * (`isMembershipLive`). A Friend Pass or a visit pass doesn't count.
 *
 * Decision 422 item 5: a membership frozen today doesn't count either, by the
 * same test booking and check-in use (`frozenMembershipIds`, Decision 404). A
 * student with another live membership that isn't frozen is still active.
 * Frozen members are counted separately, under Frozen.
 *
 * The one definition the Dashboard card and Students → Growth both use, so
 * the two numbers always agree. Returns the enrolled students too, since
 * Growth counts Visitors and frozen members among them.
 */
export async function loadActiveStudents(
  db: Db,
  freezeDb: FreezeDb,
  schoolId: string,
  now: Date = new Date(),
): Promise<{ enrolled: Set<string>; active: Set<string> }> {
  const [grants, memberships] = await Promise.all([
    db.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true } }),
    db.membership.findMany({
      where: { schoolId, status: 'ACTIVE', membershipPlan: { type: { in: [...ACTIVE_TYPES] } } },
      select: { id: true, studentId: true, status: true, expiryDate: true, classesRemaining: true },
    }),
  ]);
  const enrolled = new Set(grants.map((g) => g.userId));
  const live = memberships.filter((m) => enrolled.has(m.studentId) && isMembershipLive(m, now));
  const frozen = await frozenMembershipIds(freezeDb, schoolId, live.map((m) => m.id), [now]);
  const active = new Set(live.filter((m) => !frozen.has(m.id)).map((m) => m.studentId));
  return { enrolled, active };
}
