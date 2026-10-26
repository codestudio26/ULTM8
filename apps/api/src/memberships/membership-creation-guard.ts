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

/** Decisions 54/64: at most 30 days per Trial, and at most 30 Trial days per
 * Student per School in any rolling 12 months. */
export const TRIAL_MAX_DAYS = 30;
const TRIAL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class GeneralAccessConflictError extends Error {
  constructor() {
    super('This Student already holds an active Subscription or Weekly Pass at this School.');
  }
}

export class TrialAllowanceError extends Error {
  constructor(readonly nextTrialDate: Date | null) {
    super(
      nextTrialDate
        ? `This Student has used their 30 trial days at this School for the last 12 months. Another trial can start on ${nextTrialDate.toISOString().slice(0, 10)}.`
        : 'This Student has used their 30 trial days at this School for the last 12 months.',
    );
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
 * The advisory lock serialises concurrent creates for one Student at one
 * School until the transaction ends, so two simultaneous purchases can't both
 * pass the check (the job the unique index used to do).
 */
export async function assertCanCreateMembership(
  tx: GuardTx,
  studentId: string,
  schoolId: string,
  plan: { type: string; expiryDurationDays: number | null },
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

  if (plan.type === 'TRIAL_MEMBERSHIP') {
    const newDays = Math.min(plan.expiryDurationDays ?? TRIAL_MAX_DAYS, TRIAL_MAX_DAYS);
    const trials = await tx.membership.findMany({
      where: {
        studentId,
        schoolId,
        membershipPlan: { type: 'TRIAL_MEMBERSHIP' },
        createdAt: { gt: new Date(now.getTime() - TRIAL_WINDOW_MS) },
      },
      select: { createdAt: true, expiryDate: true },
      orderBy: { createdAt: 'asc' },
    });
    const daysOf = (t: { createdAt: Date; expiryDate: Date | null }) =>
      t.expiryDate ? Math.max(0, Math.ceil((t.expiryDate.getTime() - t.createdAt.getTime()) / DAY_MS)) : TRIAL_MAX_DAYS;
    let used = trials.reduce((sum, t) => sum + daysOf(t), 0);
    if (used + newDays > TRIAL_MAX_DAYS) {
      // The day enough of the oldest trials leave the 12-month window.
      let nextTrialDate: Date | null = null;
      for (const t of trials) {
        used -= daysOf(t);
        if (used + newDays <= TRIAL_MAX_DAYS) {
          nextTrialDate = new Date(t.createdAt.getTime() + TRIAL_WINDOW_MS);
          break;
        }
      }
      throw new TrialAllowanceError(nextTrialDate);
    }
  }
}
