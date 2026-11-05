import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';

type SchoolReader = { school: Pick<Prisma.TransactionClient['school'], 'findUnique'> };

/**
 * When an N-day pass (Weekly Pass, Trial, a Class Pack with a validity) bought
 * or given at `now` ends (Decision 432 item 8): N calendar days later at the
 * same wall-clock time in the School's time zone. It used to be N × 24 real
 * hours, an hour off the clock when a DST change fell inside the pass. A
 * School with no (or an unknown) zone counts in UTC. Hour-based cut-offs
 * ("24 hours before") stay in real hours.
 */
export function passExpiryDate(days: number | null | undefined, zone: string | null | undefined, now: Date = new Date()): Date | undefined {
  if (!days) return undefined;
  const z = zone && DateTime.local().setZone(zone).isValid ? zone : 'UTC';
  return DateTime.fromJSDate(now, { zone: z }).plus({ days }).toJSDate();
}

/** The School's time zone, for passExpiryDate (null when it has none). */
export async function schoolZoneFor(db: SchoolReader, schoolId: string): Promise<string | null> {
  return (await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }))?.timezone ?? null;
}
