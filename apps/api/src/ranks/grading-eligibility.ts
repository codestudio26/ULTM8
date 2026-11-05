import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  boardColumn,
  BoardColumn,
  BoardThresholds,
  computeEligibility,
  DEFAULT_BOARD_THRESHOLDS,
  DEFAULT_TICKS,
  Eligibility,
  localDay,
  RequirementTicks,
  requirementFor,
  Rung,
} from './engine';
import { loadLadder } from './grading-attendance';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type StudentEligibility = Eligibility & { boardColumn?: BoardColumn };

/** What a style's ticked requirements need beyond the StudentRank row
 * (Decision 321): the style's ticks, hours trained and days attended since
 * the current rank date, and the date of birth. Each is read only when the
 * style ticks it. */
export interface RequirementExtras {
  ticks: RequirementTicks;
  minutesTrained?: number;
  daysAttended?: number;
  dateOfBirth?: Date | null;
}

/**
 * Roadmap Phase 2c: a student's readiness for their next rung in one style,
 * from the grading engine (Decisions 127, 136, 149, 171, 321). Days are
 * counted in the student's local time: their home branch's time zone, else
 * the School's, else UTC (Decision 172). The board column uses the style's
 * own thresholds (Decisions 75, 136, 181), 33% / 66% unless changed.
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
  extras?: RequirementExtras,
): Promise<StudentEligibility> {
  return eligibilityOnLadder(await loadLadder(tx, studentRank.disciplineId), studentRank, timeZone, now, thresholds, extras);
}

/** As studentEligibility, on a ladder already loaded (the Grading Board loads
 * it once for every student). Without `extras`, the style is read as ticking
 * classes, days in rank and skills only (DEFAULT_TICKS). */
export function eligibilityOnLadder(
  ladder: Rung[],
  studentRank: Parameters<typeof studentEligibility>[1],
  timeZone: string,
  now: Date = new Date(),
  thresholds: BoardThresholds = DEFAULT_BOARD_THRESHOLDS,
  extras?: RequirementExtras,
): StudentEligibility {
  const req = requirementFor(ladder, studentRank.currentStripeId ?? '', extras?.ticks ?? DEFAULT_TICKS);
  const eligibility = computeEligibility(req, {
    rankDate: localDay(studentRank.dateOfCurrentRank, timeZone),
    today: localDay(now, timeZone),
    classes: {
      total: studentRank.classesAttendedTowardCheckpoint,
      byType: (studentRank.classesAttendedByType ?? {}) as Record<string, number>,
    },
    signedSkillIds: studentRank.skillStatuses.filter((s) => s.status === 'SIGNED_OFF').map((s) => s.skillId),
    minutesTrained: extras?.minutesTrained,
    daysAttended: extras?.daysAttended,
    dateOfBirth: extras?.dateOfBirth ? extras.dateOfBirth.toISOString().slice(0, 10) : null,
  });
  return eligibility.hasNext ? { ...eligibility, boardColumn: boardColumn(eligibility.progressPercent, thresholds) } : eligibility;
}

/** A style's requirement settings, as the eligibility reads need them. */
export const REQUIREMENT_SETTINGS_SELECT = {
  requireClasses: true,
  requireDaysInRank: true,
  requireSkills: true,
  requireHours: true,
  requireDaysAttended: true,
  requireMinimumAge: true,
} as const;

/**
 * Hours trained, days attended and dates of birth for several students in
 * one style, each counted from that student's own current rank date
 * (Decision 321 items 2–4), and only what the style ticks. `db` must be
 * able to read every student's TrainingLog rows and date of birth: the
 * student's own context for one student, or ultm8_jobs for students the
 * caller is already allowed to see (the Grading Board, the grading job).
 *
 * - Hours: TrainingLog minutes that count toward hours (open mat only while
 *   its switch was on when logged), trained on or after the rank date.
 * - Days attended: different calendar days, in the student's time zone, with
 *   a check-in (TrainingLog CHECK_IN, written once per style per check-in) to
 *   a class of the style on or after the rank date. A "Log a class" entry is
 *   not a check-in, so it adds no day.
 */
export async function requirementExtrasFor(
  db: TenantTx,
  disciplineId: string,
  ticks: RequirementTicks,
  rows: Array<{ studentId: string; dateOfCurrentRank: Date; timeZone: string }>,
): Promise<Map<string, RequirementExtras>> {
  const out = new Map<string, RequirementExtras>(rows.map((r) => [r.studentId, { ticks }]));
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.studentId);
  const needsLog = ticks.hours || ticks.daysAttended;
  // The earliest rank date bounds the read; each student's own date is applied below.
  const earliest = new Date(Math.min(...rows.map((r) => r.dateOfCurrentRank.getTime())));
  const [logs, births] = await Promise.all([
    needsLog
      ? db.trainingLog.findMany({
          where: { disciplineId, studentId: { in: ids }, trainedAt: { gte: earliest } },
          select: { studentId: true, minutes: true, source: true, countsTowardHours: true, trainedAt: true },
        })
      : Promise.resolve([]),
    ticks.minimumAge ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, dateOfBirth: true } }) : Promise.resolve([]),
  ]);
  const rowOf = new Map(rows.map((r) => [r.studentId, r]));
  const days = new Map<string, Set<string>>();
  for (const log of logs) {
    const row = rowOf.get(log.studentId);
    if (!row || log.trainedAt < row.dateOfCurrentRank) continue;
    const extras = out.get(log.studentId)!;
    if (ticks.hours && log.countsTowardHours) extras.minutesTrained = (extras.minutesTrained ?? 0) + log.minutes;
    if (ticks.daysAttended && log.source === 'CHECK_IN') {
      const set = days.get(log.studentId) ?? new Set<string>();
      set.add(localDay(log.trainedAt, row.timeZone));
      days.set(log.studentId, set);
    }
  }
  for (const [studentId, set] of days) out.get(studentId)!.daysAttended = set.size;
  for (const b of births) out.get(b.id)!.dateOfBirth = b.dateOfBirth;
  return out;
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
