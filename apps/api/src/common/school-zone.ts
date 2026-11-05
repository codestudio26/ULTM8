import { PrismaClient } from '@prisma/client';

type ZoneReader = Pick<PrismaClient, 'school' | 'branch'>;

/**
 * The time zone a School keeps its calendar in: the Branch's own zone when a
 * Branch is known and has one, else the School's, else null (UTC). Used to
 * count an 18th birthday on the local date (Decision 429 item 10, FAM-10),
 * the same Branch-then-School order a Class's clock uses (classTimeZone).
 *
 * Read on the connection the caller passes; callers pass the jobs connection
 * after their own access checks, since a time zone is not private and a
 * Guardian (no RoleGrant at the School) could not read it under RLS.
 */
export async function schoolZone(db: ZoneReader, schoolId: string | null | undefined, branchId?: string | null): Promise<string | null> {
  if (branchId) {
    const branch = await db.branch.findUnique({ where: { id: branchId }, select: { timezone: true, schoolId: true } });
    if (branch?.timezone && (!schoolId || branch.schoolId === schoolId)) return branch.timezone;
  }
  if (!schoolId) return null;
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  return school?.timezone ?? null;
}
