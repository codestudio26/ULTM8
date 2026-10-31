import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { R2ClientService } from '../common/object-storage/r2-client.service';

/**
 * Erases member files (backlog 5.11, Decision 315 item 9: "erased with the
 * account"), for the purge jobs: an erased account's files (studentId set to
 * null by the account's deletion) and a purged School's. Each stored file
 * goes first, then its row; when the stored file can't be deleted the row
 * stays, so the next sweep tries both again and no file is left without a
 * record (the rule EntityOffboardingPurgeProcessor already follows for a
 * signature's drawn image). Without R2 configured (local development) only
 * the rows go, with a warning, as there.
 */
export async function eraseMemberFiles(
  prismaJobs: PrismaJobsService,
  r2Client: Pick<R2ClientService, 'isConfigured' | 'deleteObject'>,
  logger: Logger,
  where: Prisma.MemberFileWhereInput,
): Promise<{ deleted: number; failed: number }> {
  const rows = await prismaJobs.memberFile.findMany({ where, select: { id: true, objectKey: true } });
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (r2Client.isConfigured()) {
        await r2Client.deleteObject(row.objectKey);
      } else {
        logger.warn(`R2 is not configured, so the stored copy of member file ${row.id} was not deleted.`);
      }
      await prismaJobs.memberFile.deleteMany({ where: { id: row.id } });
      deleted += 1;
    } catch (err) {
      failed += 1;
      logger.error(`Member file ${row.id} could not be erased; it will be tried again on the next sweep.`, err as Error);
    }
  }
  return { deleted, failed };
}
