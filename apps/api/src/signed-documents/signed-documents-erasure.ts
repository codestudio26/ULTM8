import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { R2ClientService } from '../common/object-storage/r2-client.service';

/**
 * Deletes stored signed-documents ZIPs (Decision 315 item 13) for the purge
 * jobs: each export's ZIP 24 hours after it was made (expiresAt), and every
 * one of a School that is being purged. The stored file goes first, then the
 * row is marked EXPIRED without its key; when the file can't be deleted the
 * row keeps its key, so the next sweep tries again (member-file-erasure.ts's
 * rule). The row itself stays as the record of the export.
 */
export async function eraseSignedDocumentExports(
  prismaJobs: PrismaJobsService,
  r2Client: Pick<R2ClientService, 'isConfigured' | 'deleteObject'>,
  logger: Logger,
  where: Prisma.SignedDocumentExportWhereInput,
): Promise<{ deleted: number; failed: number }> {
  const rows = await prismaJobs.signedDocumentExport.findMany({ where: { ...where, objectKey: { not: null } }, select: { id: true, objectKey: true } });
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (r2Client.isConfigured()) {
        await r2Client.deleteObject(row.objectKey as string);
      } else {
        logger.warn(`R2 is not configured, so the stored ZIP of signed-documents export ${row.id} was not deleted.`);
      }
      await prismaJobs.signedDocumentExport.update({ where: { id: row.id }, data: { status: 'EXPIRED', objectKey: null } });
      deleted += 1;
    } catch (err) {
      failed += 1;
      logger.error(`Signed-documents export ${row.id} could not be deleted; it will be tried again on the next sweep.`, err as Error);
    }
  }
  return { deleted, failed };
}
