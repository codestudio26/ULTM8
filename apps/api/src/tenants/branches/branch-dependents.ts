import { PrismaClient } from '@prisma/client';

/** The models the Branch dependents check reads — satisfied by both a tenant
 * transaction (BranchesService.close) and the ultm8_jobs client
 * (EntityOffboardingPurgeProcessor), so both ends apply the same rule. */
type BranchDependentsClient = Pick<PrismaClient, 'class' | 'timetableSlot' | 'instructor' | 'studentHomeBranch' | 'roleGrant'>;

export interface BranchDependentCounts {
  classes: number;
  timetableSlots: number;
  instructors: number;
  students: number;
  roleGrants: number;
}

/** Decision 330 (fix 5) — only what is still in use blocks closing a Branch:
 * classes that haven't ended yet, weekly timetable slots and Instructor
 * profiles that aren't archived, home-branch Students, and active staff or
 * coach roles. A past or archived Class stays linked to the Branch as history
 * and no longer blocks (Decision 252/293 counted every row). Slots stay in
 * because the class-occurrence-generation job copies a slot's branchId onto
 * every Class it creates (Decision 293). */
export async function countBranchDependents(
  client: BranchDependentsClient,
  branchId: string,
  now: Date = new Date(),
): Promise<BranchDependentCounts> {
  const [classes, timetableSlots, instructors, students, roleGrants] = await Promise.all([
    client.class.count({ where: { branchId, archivedAt: null, endDate: { gte: now } } }),
    client.timetableSlot.count({ where: { branchId, archivedAt: null } }),
    client.instructor.count({ where: { branchId, archivedAt: null } }),
    client.studentHomeBranch.count({ where: { branchId } }),
    client.roleGrant.count({ where: { branchId, revokedAt: null } }),
  ]);
  return { classes, timetableSlots, instructors, students, roleGrants };
}

export function hasBranchDependents(counts: BranchDependentCounts): boolean {
  return Object.values(counts).some((n) => n > 0);
}

/** Decision 330 (fix 7) — whether a Branch has a past worth keeping: any Class
 * (past, future or archived — Bookings and attendance hang off it), any
 * timetable slot or Instructor profile, or any staff/coach role ever scoped to
 * it (RoleGrant is an audit trail, never hard-deleted, but its branchId FK
 * cascades). A closed Branch with history is never purged: deleting it would
 * set those Classes' branchId to null (FK SET NULL), so past classes would
 * read as whole-School, and the cascade would delete the role history. */
export async function branchHasHistory(client: BranchDependentsClient, branchId: string): Promise<boolean> {
  const [classes, timetableSlots, instructors, roleGrants] = await Promise.all([
    client.class.count({ where: { branchId }, take: 1 }),
    client.timetableSlot.count({ where: { branchId }, take: 1 }),
    client.instructor.count({ where: { branchId }, take: 1 }),
    client.roleGrant.count({ where: { branchId }, take: 1 }),
  ]);
  return classes + timetableSlots + instructors + roleGrants > 0;
}

/** One line per kind of dependent, for the 409 the School Portal shows. */
export function describeBranchDependents(counts: BranchDependentCounts): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const reasons: string[] = [];
  if (counts.classes > 0) reasons.push(plural(counts.classes, 'upcoming Class', 'upcoming Classes'));
  if (counts.timetableSlots > 0) reasons.push(plural(counts.timetableSlots, 'weekly timetable slot', 'weekly timetable slots'));
  if (counts.instructors > 0) reasons.push(plural(counts.instructors, 'Instructor profile', 'Instructor profiles'));
  if (counts.students > 0) reasons.push(`${plural(counts.students, 'Student', 'Students')} with this as their home branch`);
  if (counts.roleGrants > 0) reasons.push(`${plural(counts.roleGrants, 'active staff/instructor role grant', 'active staff/instructor role grants')} scoped to it`);
  return reasons;
}
