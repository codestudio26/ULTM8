import { PrismaClient } from '@prisma/client';
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

/** Every rung of a style, in ladder order, in the engine's shape. */
export async function loadLadder(tx: TenantTx, disciplineId: string): Promise<Rung[]> {
  const ranks = await tx.rank.findMany({
    where: { disciplineId },
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
 *   before the last rank change.
 */
export async function creditAttendance(
  tx: TenantTx,
  studentId: string,
  booking: { id: string; classId: string },
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

    const req = requirementFor(await loadLadder(tx, style.disciplineId), studentRank.currentStripeId ?? '');
    if (req.kind === 'NEXT' && req.timeOnly) continue;
    const rules = req.kind === 'NEXT' ? req.countRules : COUNT_EVERYTHING;

    const thisClass: AttendedClass = { day, at: cls.startDate.toISOString(), classType: style.classType };
    const others = await sameWeekAttendance(tx, studentId, booking.id, style.disciplineId, cls.startDate, studentRank.countingSince, week);
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

