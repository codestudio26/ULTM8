import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Decision 316 item 5, as answered by Decision 435 items 10-15: a plan's
 * member limit.
 *
 * - Item 10: live and frozen members, Cash/Bank payments still waiting, and a
 *   place held for someone on the waiting list take a place, each person once
 *   (plan_places_taken(), migration 20270225100200).
 * - Item 12: members can't buy over the limit; owners and staff can sell over
 *   it at the desk (the desk never calls this).
 * - Item 15: a limit lowered below the count keeps everyone; the plan is shut
 *   to new buyers until there is room.
 * - Someone who already holds a live membership on the plan already has their
 *   place, so buying it again (another pack) is never refused for the limit.
 * - A place held for them (OFFERED, 24 hours) is theirs: only the others'
 *   places are counted.
 */
export const PLAN_FULL = {
  code: 'PLAN_FULL',
  message: 'This plan is full. Join its waiting list to be told when a place frees up.',
};

type Reader = { $queryRaw: (query: Prisma.Sql) => Promise<unknown> } & Pick<Prisma.TransactionClient, 'membership'>;

/** Places on the plan taken by people other than `studentId` (all people when null). */
export async function placesTaken(db: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> }, planId: string, studentId: string | null): Promise<number> {
  const rows = (await db.$queryRaw(Prisma.sql`SELECT "plan_places_taken"(${planId}, ${studentId}) AS taken`)) as Array<{ taken: number | null }>;
  return Number(rows[0]?.taken ?? 0);
}

/** Whether `studentId` holds a live membership on the plan (their place). */
export async function holdsPlace(db: Pick<Prisma.TransactionClient, 'membership'>, planId: string, studentId: string, now: Date = new Date()): Promise<boolean> {
  const held = await db.membership.findFirst({
    where: {
      membershipPlanId: planId,
      studentId,
      status: 'ACTIVE',
      AND: [{ OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] }, { OR: [{ classesRemaining: null }, { classesRemaining: { gt: 0 } }] }],
    },
    select: { id: true },
  });
  return !!held;
}

/** Whether the plan has no room for `studentId` (false when it has no limit). */
export async function planFullFor(db: Reader, plan: { id: string; memberLimit: number | null }, studentId: string): Promise<boolean> {
  if (plan.memberLimit == null) return false;
  if (await holdsPlace(db, plan.id, studentId)) return false;
  return (await placesTaken(db, plan.id, studentId)) >= plan.memberLimit;
}

/** Refuses a member's purchase of a full plan (item 12). */
export async function assertPlanHasRoom(db: Reader, plan: { id: string; memberLimit: number | null }, studentId: string): Promise<void> {
  if (await planFullFor(db, plan, studentId)) throw new ConflictException(PLAN_FULL);
}
