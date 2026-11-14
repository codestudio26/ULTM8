import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

type InstructorWriter = { instructor: Pick<Prisma.TransactionClient['instructor'], 'createMany'> };

/**
 * Every coach has an Instructor row at each School where they hold the
 * INSTRUCTOR role, however they got it (owner's choice, 14 Nov 2026, Option
 * A): an empty one (id, userId, schoolId, branchId), the same minimal row
 * InstructorsService.createManually() makes, filled in later on "My coach
 * profile".
 *
 * Runs inside the caller's transaction, under the tenant context the grant is
 * written in, so instructor_tenant_isolation decides as for any other write.
 * A row for that School and user (archived included) is kept as it is: the
 * schoolId+userId unique index makes this INSERT ... ON CONFLICT DO NOTHING,
 * so a twin request, or a re-grant after a revoke, never adds a second row
 * and never fails the grant.
 */
export async function ensureInstructorProfile(
  tx: InstructorWriter,
  row: { userId: string; schoolId: string; branchId: string | null },
): Promise<void> {
  await tx.instructor.createMany({
    data: [{ id: randomUUID(), userId: row.userId, schoolId: row.schoolId, branchId: row.branchId }],
    skipDuplicates: true,
  });
}
