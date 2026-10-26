import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Decision 283 — only active students are graded up. A grading fixture student
 * needs a live Membership (or a board Active override) to be promotable, so the
 * grading suites call this from their student helpers. One shared plan per School.
 */
const planBySchool = new Map<string, string>();

export async function giveLiveMembership(db: PrismaClient, schoolId: string, studentId: string): Promise<void> {
  let planId = planBySchool.get(schoolId);
  if (!planId) {
    planId = randomUUID();
    await db.membershipPlan.create({ data: { id: planId, schoolId, type: 'SUBSCRIPTION', title: 'Unlimited (test)', price: 5000 } });
    planBySchool.set(schoolId, planId);
  }
  await db.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: planId, schoolId, frequency: 'RECURRING' } });
}

export async function giveLiveMemberships(db: PrismaClient, schoolId: string, studentIds: string[]): Promise<void> {
  if (!studentIds.length) return;
  const [first, ...rest] = studentIds;
  await giveLiveMembership(db, schoolId, first);
  const planId = planBySchool.get(schoolId)!;
  if (rest.length) await db.membership.createMany({ data: rest.map((studentId) => ({ id: randomUUID(), studentId, membershipPlanId: planId, schoolId, frequency: 'RECURRING' as const })) });
}
