import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

/**
 * Decision 419 item 1: medical information is deleted when the member leaves
 * the School (it is no longer needed there).
 *
 * Deletes the StudentMedicalInfo rows of students who are no longer a
 * Student at that School (no live STUDENT RoleGrant there). Re-checked in the
 * same statement, so it is safe to call at any time: someone who is still (or
 * again) a Student keeps theirs.
 *
 * - With `schoolId` and `studentId`: one person at one School, called right
 *   after their enrolment ends (RoleGrantsService.revoke).
 * - With neither: every School, the daily entity-offboarding-purge sweep, a
 *   safety net for a delete that failed after the enrolment ended, and for any
 *   other way an enrolment can end.
 *
 * Jobs connection only, like every other StudentMedicalInfo read and write.
 */
export async function deleteMedicalInfoOfLeavers(prismaJobs: PrismaJobsService, scope: { schoolId: string; studentId: string } | null = null): Promise<number> {
  const only = scope ? Prisma.sql`AND m."schoolId" = ${scope.schoolId} AND m."studentId" = ${scope.studentId}` : Prisma.empty;
  return prismaJobs.$executeRaw`
    DELETE FROM "StudentMedicalInfo" m
    WHERE NOT EXISTS (
      SELECT 1 FROM "RoleGrant" g
      WHERE g."userId" = m."studentId" AND g."schoolId" = m."schoolId" AND g."role" = 'STUDENT' AND g."revokedAt" IS NULL
    ) ${only}`;
}
