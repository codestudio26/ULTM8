import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

type ClassStyle = { disciplineId: string; classType: string | null };

/**
 * Hours trained (Decisions 301 items 1, 5, 6 and 306): a RECORD ONLY. Nothing
 * here is read by the grading engine — no requirement, no %, no readiness,
 * no board column. Stored as whole minutes (TrainingLog.minutes) so nothing
 * is ever a fraction; the apps show hours.
 */

/** "Log a class" without a class: the coach's time, 60 minutes by default (Decision 301 item 5). */
export const DEFAULT_LOGGED_MINUTES = 60;

/** A class's scheduled length in whole minutes (Decision 301 item 1:
 * students check in only, never out, so the schedule is the length). Never
 * negative. */
export function classMinutes(cls: { startDate: Date; endDate: Date }): number {
  return Math.max(0, Math.round((cls.endDate.getTime() - cls.startDate.getTime()) / 60_000));
}

/** The class type a scheduled open mat carries (Decision 304 item 1). Class
 * types are free text per style (Discipline.classTypesOffered), so this is an
 * exact match on the name "Open mat", ignoring case and outer spaces.
 * NEEDS PRODUCT-OWNER CONFIRMATION: no decision fixes the spelling; a
 * School that names it differently ("Open Mat Session", "Randori") is not
 * treated as open mat. */
export const OPEN_MAT_CLASS_TYPE = 'Open mat';

export function isOpenMat(classType: string | null | undefined): boolean {
  return typeof classType === 'string' && classType.trim().toLowerCase() === OPEN_MAT_CLASS_TYPE.toLowerCase();
}

/** Whether a School logs open mat time in hours ("Open mat counts toward
 * hours", Decision 301 item 6; off by default). Read under whichever context
 * the caller runs in: School rows are readable by anyone holding a role there. */
async function openMatCounts(tx: TenantTx, schoolId: string): Promise<boolean> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { openMatCountsTowardHours: true } });
  return school?.openMatCountsTowardHours ?? false;
}

/**
 * Check-in (Decision 301 item 1): one TrainingLog row per style the class
 * lists, each with the class's scheduled length. Called inside the check-in
 * transaction, under the student's own context, after the booking is marked
 * Completed — the same place creditAttendance() runs, and independent of it.
 *
 * - A class with no styles logs nothing (hours are per style, as classes are).
 * - Every style on the class is logged, ranked in or not, and whatever the
 *   current rung (time-only included): it is a record of training, not a
 *   count toward a grade. NEEDS PRODUCT-OWNER CONFIRMATION (narrowest reading
 *   of "each check-in adds the scheduled length").
 * - Open mat: the row is still written, flagged, with countsTowardHours set
 *   from the School's switch at the moment of the check-in. Turning the
 *   switch on or off later does not rewrite earlier rows. NEEDS PRODUCT-OWNER
 *   CONFIRMATION (Decision 306 says the switch decides "whether open mat time
 *   is logged", read here as at the time it is logged).
 */
export async function recordCheckInMinutes(tx: TenantTx, studentId: string, booking: { id: string; classId: string }): Promise<void> {
  const cls = await tx.class.findUniqueOrThrow({
    where: { id: booking.classId },
    select: { id: true, schoolId: true, startDate: true, endDate: true, styles: true },
  });
  const styles = cls.styles as unknown as ClassStyle[];
  if (!styles.length) return;
  const minutes = classMinutes(cls);
  if (minutes === 0) return;
  const openMatOn = styles.some((s) => isOpenMat(s.classType)) ? await openMatCounts(tx, cls.schoolId) : false;
  const seen = new Set<string>();
  for (const style of styles) {
    if (seen.has(style.disciplineId)) continue; // one row per style, like creditAttendance
    seen.add(style.disciplineId);
    const openMat = isOpenMat(style.classType);
    await tx.trainingLog.create({
      data: {
        id: randomUUID(),
        schoolId: cls.schoolId,
        studentId,
        disciplineId: style.disciplineId,
        minutes,
        source: 'CHECK_IN',
        openMat,
        countsTowardHours: !openMat || openMatOn,
        classId: cls.id,
        bookingId: booking.id,
        trainedAt: cls.startDate,
      },
    });
  }
}

/**
 * "Log a class" by hand (Decision 301 item 5): the picked class's length, or
 * the minutes the coach entered (60 by default). Written in the same
 * transaction as the log-a-class history entry, under the student's context.
 * Returns the minutes added to hours (0 when the open mat switch keeps it out).
 */
export async function recordLoggedMinutes(
  tx: TenantTx,
  input: {
    schoolId: string;
    studentId: string;
    disciplineId: string;
    minutes: number;
    classType: string | null;
    classId: string | null;
    trainedAt: Date;
    promotionEventId: string;
  },
): Promise<number> {
  if (input.minutes <= 0) return 0;
  const openMat = isOpenMat(input.classType);
  const countsTowardHours = !openMat || (await openMatCounts(tx, input.schoolId));
  await tx.trainingLog.create({
    data: {
      id: randomUUID(),
      schoolId: input.schoolId,
      studentId: input.studentId,
      disciplineId: input.disciplineId,
      minutes: input.minutes,
      source: 'LOGGED',
      openMat,
      countsTowardHours,
      classId: input.classId,
      promotionEventId: input.promotionEventId,
      trainedAt: input.trainedAt,
    },
  });
  return countsTowardHours ? input.minutes : 0;
}

export interface HoursTrained {
  /** Every minute logged in this style at this School. */
  totalMinutes: number;
  /** Minutes trained on or after the current rank date (dateOfCurrentRank). */
  sinceCurrentRankMinutes: number;
}

/** A student's hours trained in one style at one School. Run under the
 * student's own context, like every grading read (TrainingLog's RLS: the
 * School owner or the student). */
export async function hoursTrained(
  tx: TenantTx,
  row: { studentId: string; schoolId: string; disciplineId: string; dateOfCurrentRank: Date },
): Promise<HoursTrained> {
  const where = { studentId: row.studentId, schoolId: row.schoolId, disciplineId: row.disciplineId, countsTowardHours: true };
  const [total, since] = await Promise.all([
    tx.trainingLog.aggregate({ where, _sum: { minutes: true } }),
    tx.trainingLog.aggregate({ where: { ...where, trainedAt: { gte: row.dateOfCurrentRank } }, _sum: { minutes: true } }),
  ]);
  return { totalMinutes: total._sum.minutes ?? 0, sinceCurrentRankMinutes: since._sum.minutes ?? 0 };
}
