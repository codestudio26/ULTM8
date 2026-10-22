import { PrismaClient } from '@prisma/client';

/** The models the Branch dependents check reads — satisfied by both a tenant
 * transaction (BranchesService.archive) and the ultm8_jobs client
 * (EntityOffboardingPurgeProcessor), so both ends apply the same rule. */
type BranchDependentsClient = Pick<PrismaClient, 'class' | 'timetableSlot' | 'instructor' | 'studentHomeBranch' | 'roleGrant'>;

export interface BranchDependentCounts {
  classes: number;
  timetableSlots: number;
  instructors: number;
  students: number;
  roleGrants: number;
}

/** Decision 252's "active dependents" for a Branch: any Class, Instructor
 * profile, home-branch Student or non-revoked RoleGrant pointing at it —
 * plus any TimetableSlot (Decision 293), since the class-occurrence-generation
 * job copies a slot's branchId onto every Class it creates, so a slot left
 * on an archived Branch keeps adding Classes to it. Counted the same way as
 * Class (every row, not only active ones) to keep Decision 252's rule. */
export async function countBranchDependents(client: BranchDependentsClient, branchId: string): Promise<BranchDependentCounts> {
  const [classes, timetableSlots, instructors, students, roleGrants] = await Promise.all([
    client.class.count({ where: { branchId } }),
    client.timetableSlot.count({ where: { branchId } }),
    client.instructor.count({ where: { branchId } }),
    client.studentHomeBranch.count({ where: { branchId } }),
    client.roleGrant.count({ where: { branchId, revokedAt: null } }),
  ]);
  return { classes, timetableSlots, instructors, students, roleGrants };
}

export function hasBranchDependents(counts: BranchDependentCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}

/** One line per kind of dependent, for the 409 the School Portal shows. */
export function describeBranchDependents(counts: BranchDependentCounts): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const reasons: string[] = [];
  if (counts.classes > 0) reasons.push(plural(counts.classes, 'Class', 'Classes'));
  if (counts.timetableSlots > 0) reasons.push(plural(counts.timetableSlots, 'weekly timetable slot', 'weekly timetable slots'));
  if (counts.instructors > 0) reasons.push(plural(counts.instructors, 'Instructor profile', 'Instructor profiles'));
  if (counts.students > 0) reasons.push(`${plural(counts.students, 'Student', 'Students')} with this as their home branch`);
  if (counts.roleGrants > 0) reasons.push(`${plural(counts.roleGrants, 'active staff/instructor role grant', 'active staff/instructor role grants')} scoped to it`);
  return reasons;
}
