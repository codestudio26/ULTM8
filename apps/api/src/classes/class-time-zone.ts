import { PrismaClient } from '@prisma/client';

type Tx = Pick<PrismaClient, 'branch' | 'school'>;

/**
 * The clock a Class runs on (Decision 427, Student portal review SP6): its
 * Branch's time zone, else its School's, else null (the app then uses UTC).
 * The same order the School Portal (`classZone`) and
 * `class-occurrence-generation` use. Pure, so the discovery read (which
 * selects the zones itself) and the member reads share one rule.
 */
export function classTimeZone(branchTimezone: string | null | undefined, schoolTimezone: string | null | undefined): string | null {
  return branchTimezone || schoolTimezone || null;
}

/**
 * Each Class's clock, read in the caller's own context: a Branch or School
 * the caller can't read just falls through to the next one (a hidden Branch
 * gives the School's zone; a hidden School gives null). Two small reads,
 * whatever the number of classes.
 */
export async function classTimeZones(
  tx: Tx,
  classes: Array<{ id: string; schoolId: string; branchId: string | null }>,
): Promise<Map<string, string | null>> {
  const branchIds = [...new Set(classes.map((c) => c.branchId).filter((id): id is string => !!id))];
  const schoolIds = [...new Set(classes.map((c) => c.schoolId))];
  const none: Array<{ id: string; timezone: string | null }> = [];
  const [branches, schools] = await Promise.all([
    branchIds.length ? tx.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, timezone: true } }) : none,
    schoolIds.length ? tx.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, timezone: true } }) : none,
  ]);
  const branchZone = new Map<string, string | null>(branches.map((b) => [b.id, b.timezone]));
  const schoolZone = new Map<string, string | null>(schools.map((s) => [s.id, s.timezone]));
  return new Map(classes.map((c) => [c.id, classTimeZone(c.branchId ? branchZone.get(c.branchId) : null, schoolZone.get(c.schoolId))]));
}
