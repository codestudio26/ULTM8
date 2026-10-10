import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { boardColumn, BoardColumn, BoardThresholds, computeEligibility, DEFAULT_BOARD_THRESHOLDS, Eligibility, localDay, requirementFor, Rung } from './engine';
import { loadLadder } from './grading-attendance';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type StudentEligibility = Eligibility & { boardColumn?: BoardColumn };

/**
 * Roadmap Phase 2c: a student's readiness for their next rung in one style,
 * from the grading engine (Decisions 127, 136, 149, 171). Days are counted in
 * the student's local time: their home branch's time zone, else the School's,
 * else UTC (Decision 172). The board column uses the style's own
 * thresholds (Decisions 75, 136, 181), 33% / 66% unless changed.
 */
export async function studentEligibility(
  tx: TenantTx,
  studentRank: {
    disciplineId: string;
    currentStripeId: string | null;
    dateOfCurrentRank: Date;
    classesAttendedTowardCheckpoint: number;
    classesAttendedByType: unknown;
    skillStatuses: Array<{ skillId: string; status: string }>;
  },
  timeZone: string,
  now: Date = new Date(),
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
): Promise<StudentEligibility> {
  return eligibilityOnLadder(await loadLadder(tx, studentRank.disciplineId), studentRank, timeZone, now, thresholds);
}

/** As studentEligibility, on a ladder already loaded (the Grading Board loads
 * it once for every student). */
export function eligibilityOnLadder(
  ladder: Rung[],
  studentRank: Parameters<typeof studentEligibility>[1],
  timeZone: string,
  now: Date = new Date(),
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
): StudentEligibility {
  const req = requirementFor(ladder, studentRank.currentStripeId ?? '');
  const eligibility = computeEligibility(req, {
    rankDate: localDay(studentRank.dateOfCurrentRank, timeZone),
    today: localDay(now, timeZone),
    classes: {
      total: studentRank.classesAttendedTowardCheckpoint,
      byType: (studentRank.classesAttendedByType ?? {}) as Record<string, number>,
    },
    signedSkillIds: studentRank.skillStatuses.filter((s) => s.status === 'SIGNED_OFF').map((s) => s.skillId),
  });
  return eligibility.hasNext ? { ...eligibility, boardColumn: boardColumn(eligibility.progressPercent, thresholds) } : eligibility;
}

/** A style's Grading Board thresholds (Decisions 75, 136, 181). */
export function thresholdsOf(discipline: { boardGettingThere: number; boardReadyToGrade: number }): BoardThresholds {
  return { gettingThere: discipline.boardGettingThere, readyToGrade: discipline.boardReadyToGrade };
}

/** The student's local time zone at a School: home branch, else School, else UTC. */
export async function studentTimeZone(tx: TenantTx, studentId: string, schoolId: string): Promise<string> {
  const [home, school] = await Promise.all([
    tx.studentHomeBranch.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { branch: { select: { timezone: true } } } }),
    tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }),
  ]);
  return home?.branch.timezone ?? school?.timezone ?? 'UTC';
}

/** The instant a local calendar day (YYYY-MM-DD) starts in a time zone, so a
 * date typed by a coach (back-dated grade, edited rank date) reads back as the
 * same day in that zone. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const dt = DateTime.fromISO(day, { zone: timeZone }).startOf('day');
  if (!dt.isValid) throw new Error(`Invalid day or time zone: ${day} ${timeZone}`);
  return dt.toJSDate();
}
