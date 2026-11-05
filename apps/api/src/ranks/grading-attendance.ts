import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  AttendedClass,
  ClassTypeRequirement,
  countClasses,
  CountRules,
  flattenLadder,
  localDay,
  requirementFor,
  Rung,
  weekStart,
  dayNumber,
} from './engine';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

type ClassStyle = { disciplineId: string; classType: string | null };

const DAY_MS = 86_400_000;

export interface CreditAttendanceOptions {
  /** Count the class only if it is on or after the day the current belt was
   * awarded (StudentRank.dateOfCurrentRank). */
  onlySinceRankDate?: boolean;
}

/** Every rung of a style, in ladder order, in the engine's shape. Archived
 * belts are not part of the ladder: nobody can be graded into them (Decision
 * 308). Archiving needs a belt nobody holds or held, so no student is on one. */
export async function loadLadder(tx: TenantTx, disciplineId: string): Promise<Rung[]> {
  const ranks = await tx.rank.findMany({
    where: { disciplineId, archivedAt: null },
    include: { stripeTiers: { include: { requiredSkills: { select: { skillId: true } } } } },
  });
  return flattenLadder(
    ranks.map((rank) => ({
      id: rank.id,
      order: rank.order,
      stripeTiers: rank.stripeTiers.map((t) => ({
        id: t.id,
        order: t.order,
        name: t.name,
        timeOnly: t.timeOnly,
        classesRequired: t.classesRequired,
        minimumDaysInRank: t.minimumDaysInRank,
        eligibleClassTypes: t.eligibleClassTypes,
        classCountMode: t.classCountMode,
        classTypeRequirements: t.classTypeRequirements as unknown as ClassTypeRequirement[],
        weeklyClassCountCap: t.weeklyClassCountCap,
        requiredSkillIds: t.requiredSkills.map((s) => s.skillId),
        bookingUnlocksClassTypes: t.bookingUnlocksClassTypes,
        hoursRequired: t.hoursRequired,
        daysAttendedRequired: t.daysAttendedRequired,
        minimumAge: t.minimumAge,
      })),
    })),
  );
}

/** A class's time zone: its Branch's, else its School's, else UTC (Decision 172). */
export function classTimeZone(cls: { branch: { timezone: string | null } | null; school: { timezone: string | null } }): string {
  return cls.branch?.timezone ?? cls.school.timezone ?? 'UTC';
}

/** Counting rules when there is no next rung to count toward (the top of the
 * ladder, or a rung that can't be found): every class counts, no cap — what
 * the counter did before the engine. */
const COUNT_EVERYTHING: CountRules = { eligibleClassTypes: [], classCountMode: 'ANY_TYPE', classTypeRequirements: [], weeklyClassCountCap: null };

/**
 * Credits one attended class toward the student's next rung in each style the
 * class lists (Decisions 140, 149, 170, 171; roadmap Phase 2b). Called inside
 * the check-in transaction, after the booking is marked Completed.
 *
 * - Each style on the class counts once, with that style's class type. A class
 *   with no styles counts toward nothing.
 * - Which types count and the weekly cap come from the engine's requirement
 *   for the student's current rung. A time-only current rung counts no
 *   classes (Decision 128, item 3).
 * - The weekly cap: the engine counts the student's classes that week (since
 *   counting toward this rung began) with and without this one, and the
 *   difference is added. So a cap that is already full adds nothing, and a
 *   class earlier in the week than ones already counted can only reshuffle the
 *   per-type numbers, never exceed the cap.
 * - The class being checked in always takes part, even if it started just
 *   before the last rank change, unless `onlySinceRankDate` is set.
 * - `onlySinceRankDate` (imported past attendance; Decisions 422 item 6 and
 *   423): the belt's own awarded date (StudentRank.dateOfCurrentRank, as
 *   typed, back-dated or imported) decides, not the moment the rank row
 *   last changed (countingSince). A class on or after that day, in the
 *   class's time zone, counts toward the next belt; an earlier one counts
 *   toward nothing in that style. The weekly cap then looks at the
 *   student's classes from that day on. Only imports pass it: every other
 *   way in keeps counting from countingSince, as before.
 */
export async function creditAttendance(
  tx: TenantTx,
  studentId: string,
  booking: { id: string; classId: string },
  opts: CreditAttendanceOptions = {},
): Promise<void> {
  const cls = await tx.class.findUniqueOrThrow({
    where: { id: booking.classId },
    select: { startDate: true, styles: true, branch: { select: { timezone: true } }, school: { select: { timezone: true } } },
  });
  const styles = cls.styles as unknown as ClassStyle[];
  if (!styles.length) return;
  const day = localDay(cls.startDate, classTimeZone(cls));
  const week = weekStart(dayNumber(day) as number);

  for (const style of styles) {
    // Locks the student's rank row for this style until the check-in commits,
    // so two check-ins at once can't both fill the last place under the cap.
    const locked = await tx.studentRank.updateMany({ where: { studentId, disciplineId: style.disciplineId }, data: { updatedAt: new Date() } });
    if (locked.count === 0) continue; // no rank in this style: attendance still counts as a check-in, not toward a rung
    const studentRank = await tx.studentRank.findUniqueOrThrow({
      where: { studentId_disciplineId: { studentId, disciplineId: style.disciplineId } },
    });
    // Imports: from the start of the day the current belt was awarded.
    const since = opts.onlySinceRankDate
      ? DateTime.fromJSDate(studentRank.dateOfCurrentRank, { zone: classTimeZone(cls) }).startOf('day').toJSDate()
      : studentRank.countingSince;
    if (opts.onlySinceRankDate && cls.startDate < since) continue;

    const req = requirementFor(await loadLadder(tx, style.disciplineId), studentRank.currentStripeId ?? '');
    if (req.kind === 'NEXT' && req.timeOnly) continue;
    const rules = req.kind === 'NEXT' ? req.countRules : COUNT_EVERYTHING;

    const thisClass: AttendedClass = { day, at: cls.startDate.toISOString(), classType: style.classType };
    const others = await sameWeekAttendance(tx, studentId, booking.id, style.disciplineId, cls.startDate, since, week);
    const before = countClasses(others, rules);
    const after = countClasses([...others, thisClass], rules);

    const byType = { ...(studentRank.classesAttendedByType as Record<string, number>) };
    for (const type of new Set([...Object.keys(before.byType), ...Object.keys(after.byType)])) {
      byType[type] = Math.max(0, (byType[type] ?? 0) + (after.byType[type] ?? 0) - (before.byType[type] ?? 0));
    }
    await tx.studentRank.update({
      where: { id: studentRank.id },
      data: {
        classesAttendedTowardCheckpoint: { increment: after.total - before.total },
        classesAttendedByType: byType,
      },
    });
  }
}

/** The student's other completed classes in this style in the same Mon–Sun
 * week (local time), since counting toward the current rung began. */
async function sameWeekAttendance(
  tx: TenantTx,
  studentId: string,
  bookingId: string,
  disciplineId: string,
  classStart: Date,
  countingSince: Date,
  week: number,
): Promise<AttendedClass[]> {
  // A window wide enough for any time zone; the exact week is checked below.
  const from = new Date(Math.max(classStart.getTime() - 8 * DAY_MS, countingSince.getTime()));
  const to = new Date(classStart.getTime() + 8 * DAY_MS);
  const bookings = await tx.booking.findMany({
    where: { studentId, status: 'COMPLETED', id: { not: bookingId }, class: { startDate: { gte: from, lte: to } } },
    select: { class: { select: { startDate: true, styles: true, branch: { select: { timezone: true } }, school: { select: { timezone: true } } } } },
  });
  const result: AttendedClass[] = [];
  for (const b of bookings) {
    const entry = (b.class.styles as unknown as ClassStyle[]).find((s) => s.disciplineId === disciplineId);
    if (!entry) continue;
    const d = localDay(b.class.startDate, classTimeZone(b.class));
    if (weekStart(dayNumber(d) as number) !== week) continue;
    result.push({ day: d, at: b.class.startDate.toISOString(), classType: entry.classType });
  }
  return result;
}

/** The history note of a first rank given on the first check-in. */
export const FIRST_RANK_NOTE = 'First rank given on the first check-in.';

/**
 * "Auto-assign first belt" (Decision 321 item 6): in each style the class
 * lists whose owner switch is on, a student with no rank there gets the
 * style's first rung, verified (Decision 147), on this check-in. Called
 * inside the check-in transaction, under the student's own context, after
 * the class has been credited, so this class itself counts toward nothing in
 * that style (counting starts from the new rank, as for any new rank).
 * Recorded in the history as automatic, with no performer. No notice is
 * sent: a first rank isn't a promotion. Not for an archived style, or a
 * School with ranks switched off. Two check-ins at once give one rank (the
 * insert skips a duplicate, and only the one that inserted writes history).
 */
export async function autoAssignFirstRanks(tx: TenantTx, studentId: string, booking: { id: string; classId: string }): Promise<void> {
  const cls = await tx.class.findUniqueOrThrow({ where: { id: booking.classId }, select: { schoolId: true, styles: true } });
  const styleIds = [...new Set((cls.styles as unknown as ClassStyle[]).map((s) => s.disciplineId))];
  if (!styleIds.length) return;
  const styles = await tx.discipline.findMany({
    where: { id: { in: styleIds }, schoolId: cls.schoolId, autoAssignFirstRank: true, archivedAt: null },
    select: { id: true },
  });
  if (!styles.length) return;
  const school = await tx.school.findUnique({ where: { id: cls.schoolId }, select: { ranksToggle: true } });
  if (!school?.ranksToggle) return;
  for (const style of styles) {
    if (await tx.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId: style.id } }, select: { id: true } })) continue;
    const first = (await loadLadder(tx, style.id))[0];
    if (!first) continue;
    const now = new Date();
    const id = randomUUID();
    const created = await tx.studentRank.createMany({
      data: [{ id, studentId, disciplineId: style.id, schoolId: cls.schoolId, currentRankId: first.rankId, currentStripeId: first.id, dateOfCurrentRank: now, countingSince: now }],
      skipDuplicates: true,
    });
    if (created.count === 0) continue;
    await tx.promotionEvent.create({
      data: {
        id: randomUUID(),
        studentRankId: id,
        schoolId: cls.schoolId,
        studentId,
        type: 'PROMOTION',
        performedById: null,
        automatic: true,
        toRankId: first.rankId,
        toStripeTierId: first.id,
        effectiveDate: now,
        systemNote: FIRST_RANK_NOTE,
        startingClasses: 0,
      },
    });
  }
}

