import { Prisma } from '@prisma/client';

/** A membership in effect now: ACTIVE, not past its expiry date (a
 * live-computed predicate, Decision 26), and not a used-up pack. Shared with
 * the Grading Board's "currently attending" (Decision 152). */
export function isMembershipLive(
  m: { status: string; expiryDate: Date | null; classesRemaining: number | null },
  now: Date = new Date(),
): boolean {
  if (m.status !== 'ACTIVE') return false;
  if (m.expiryDate && m.expiryDate < now) return false;
  if (m.classesRemaining !== null && m.classesRemaining <= 0) return false;
  return true;
}

/** The two types a Student may hold only one of at a time per School (Spec 55
 * §6.1: "cannot hold two simultaneous Active general-access Memberships
 * (Subscription or Weekly Pass)"). Trial and Class Pack are not in it: a Trial
 * student must be able to buy a Weekly Pass or Subscription (Memberships review
 * M20, Decision 334). */
export const GENERAL_ACCESS_TYPES = ['SUBSCRIPTION', 'WEEKLY_PASS'] as const;

export class GeneralAccessConflictError extends Error {
  constructor() {
    super('This Student already holds an active Subscription or Weekly Pass at this School.');
  }
}

type GuardTx = Pick<Prisma.TransactionClient, 'membership' | '$executeRaw'>;

/**
 * Run inside the same transaction as the Membership insert, at each of the
 * three places one is created (MembershipsService.createMembershipAndReturn,
 * PaymentsService.confirmTransaction, the Stripe payment_intent.succeeded
 * handler). Replaces the old partial unique index
 * `Membership_one_active_general_access_per_school`, which keyed on the stored
 * status and so kept blocking a Student whose Weekly Pass or Trial had run out
 * by date (Memberships review M1). Expiry stays live-computed (Decision 26):
 * nothing here writes Membership.status.
 *
 * A Trial has no platform limit here (Decision 410, replacing Decisions 54/64):
 * each School sets its own trial length and decides whether to give a Student
 * another trial.
 *
 * The advisory lock serialises concurrent creates for one Student at one
 * School until the transaction ends, so two simultaneous purchases can't both
 * pass the check (the job the unique index used to do).
 */
export async function assertCanCreateMembership(
  tx: GuardTx,
  studentId: string,
  schoolId: string,
  plan: { type: string },
  now: Date = new Date(),
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership:${studentId}:${schoolId}`}, 0))`;

  if ((GENERAL_ACCESS_TYPES as readonly string[]).includes(plan.type)) {
    const held = await tx.membership.findMany({
      where: { studentId, schoolId, status: 'ACTIVE', membershipPlan: { type: { in: [...GENERAL_ACCESS_TYPES] } } },
      select: { status: true, expiryDate: true, classesRemaining: true },
    });
    if (held.some((m) => isMembershipLive(m, now))) {
      throw new GeneralAccessConflictError();
    }
  }
}
