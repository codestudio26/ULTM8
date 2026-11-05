import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

/**
 * Decision 318 item 7: the member app switches each School turns on or off.
 * Read on the jobs connection after the caller's own checks: each helper only
 * ever answers about the caller, their linked children, or Schools the caller
 * already named, and returns booleans and ids, never another tenant's data.
 */

/** The profile fields a member may still change when "edit own profile" is
 * off: the app's own preferences, not their details at the School. */
export const PROFILE_PREFERENCE_FIELDS = ['language', 'currency'] as const;

/** Roles that work at a School rather than train there. Their profile is also
 * their staff identity, so a School's member switch doesn't lock it. */
const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR', 'FRANCHISE_OWNER'] as const;

/**
 * "Edit own profile" is off for this person when a School where they are a
 * current Student has it off and they hold no staff role anywhere. The
 * profile is one record shared by all their Schools, so the most careful
 * School decides.
 */
export async function isProfileLocked(prismaJobs: PrismaJobsService, userId: string): Promise<boolean> {
  const grants = await prismaJobs.roleGrant.findMany({
    where: { userId, revokedAt: null },
    select: { role: true, schoolId: true },
  });
  if (grants.some((g) => (STAFF_ROLES as readonly string[]).includes(g.role))) return false;
  const schoolIds = [...new Set(grants.filter((g) => g.role === 'STUDENT' && g.schoolId).map((g) => g.schoolId as string))];
  if (schoolIds.length === 0) return false;
  const locked = await prismaJobs.school.count({ where: { id: { in: schoolIds }, memberAppEditProfile: false } });
  return locked > 0;
}

/** Of these Schools, the ones that hide payment history from members. */
export async function schoolsHidingPaymentHistory(prismaJobs: PrismaJobsService, schoolIds: string[]): Promise<string[]> {
  if (schoolIds.length === 0) return [];
  const rows = await prismaJobs.school.findMany({ where: { id: { in: schoolIds }, memberAppPaymentHistory: false }, select: { id: true } });
  return rows.map((r) => r.id);
}

export interface MemberAppSchoolSwitches {
  schoolId: string;
  editProfile: boolean;
  cancelMembership: boolean;
  addFamily: boolean;
  paymentHistory: boolean;
  gradingCountdown: boolean;
}

/** The switches of every School where the caller, or a child linked to them,
 * is a current Student. */
export async function switchesForMember(prismaJobs: PrismaJobsService, callerId: string): Promise<MemberAppSchoolSwitches[]> {
  const links = await prismaJobs.guardianLink.findMany({ where: { guardianId: callerId, revokedAt: null }, select: { studentId: true } });
  const people = [callerId, ...links.map((l) => l.studentId)];
  const grants = await prismaJobs.roleGrant.findMany({
    where: { userId: { in: people }, role: 'STUDENT', revokedAt: null, schoolId: { not: null } },
    select: { schoolId: true },
  });
  const schoolIds = [...new Set(grants.map((g) => g.schoolId as string))];
  if (schoolIds.length === 0) return [];
  const schools = await prismaJobs.school.findMany({
    where: { id: { in: schoolIds } },
    select: {
      id: true,
      memberAppEditProfile: true,
      memberAppCancelMembership: true,
      memberAppAddFamily: true,
      memberAppPaymentHistory: true,
      memberAppGradingCountdown: true,
    },
    orderBy: { id: 'asc' },
  });
  return schools.map((s) => ({
    schoolId: s.id,
    editProfile: s.memberAppEditProfile,
    cancelMembership: s.memberAppCancelMembership,
    addFamily: s.memberAppAddFamily,
    paymentHistory: s.memberAppPaymentHistory,
    gradingCountdown: s.memberAppGradingCountdown,
  }));
}

export interface GradingCountdown {
  /** The School's next grading day (YYYY-MM-DD), only when it is today or later. */
  nextGradingDate: string | null;
  /** Whole days from the School's today to that day (0 = today). */
  daysUntilGrading: number | null;
  /** Classes still needed for the next rank; null when classes don't count (a time-only rank) or there is no next rank. */
  classesToGo: number | null;
  /** Days still needed for the next rank; null when there is no next rank. */
  daysToGo: number | null;
}

/**
 * Decision 318 item 7's grading countdown: the School's next grading day
 * ("Grading in 23 days") and the student's own countdown to being ready for
 * their next rank (classes and days still needed), from the eligibility the
 * grading engine already worked out. `today` is the School's calendar day.
 */
export function gradingCountdown(
  nextGradingDate: string | null,
  today: string,
  eligibility: { hasNext?: boolean; timeOnly?: boolean; requiredClasses?: number; countedClasses?: number; requiredDays?: number; elapsedDays?: number },
  archived: boolean,
): GradingCountdown {
  const until = nextGradingDate ? daysBetween(today, nextGradingDate) : null;
  const upcoming = until !== null && until >= 0;
  const hasNext = !archived && !!eligibility.hasNext;
  const classesToGo =
    hasNext && !eligibility.timeOnly && eligibility.requiredClasses !== undefined
      ? Math.max(0, eligibility.requiredClasses - (eligibility.countedClasses ?? 0))
      : null;
  const daysToGo = hasNext && eligibility.requiredDays !== undefined ? Math.max(0, eligibility.requiredDays - (eligibility.elapsedDays ?? 0)) : null;
  return {
    nextGradingDate: upcoming ? nextGradingDate : null,
    daysUntilGrading: upcoming ? until : null,
    classesToGo,
    daysToGo,
  };
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
