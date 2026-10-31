import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { buildSignedDocumentsZip, labelsFrom } from '../signed-documents/signed-documents-builder';
import { SIGNED_DOCUMENTS_EXPORT_QUEUE } from './queue.constants';

export interface SignedDocumentsExportJobData {
  exportId: string;
}

/** How long a made ZIP is kept before the daily sweep deletes it. */
export const SIGNED_DOCUMENTS_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/** Where an export's ZIP is stored in the private bucket. */
export const signedDocumentsExportKey = (schoolId: string, exportId: string) => `signed-document-exports/${schoolId}/${exportId}.zip`;

/**
 * Builds one signed-documents export (Decision 315 item 13), queued by
 * SignedDocumentsExportService once the owner asks: every signed waiver at
 * the School as a ZIP in the private R2 bucket, downloaded through a
 * 5-minute signed link. Runs as ultm8_jobs (the owner was checked when the
 * export was asked for; every read here names that School). A failure marks
 * the export FAILED, and the owner can ask again.
 */
@Processor(SIGNED_DOCUMENTS_EXPORT_QUEUE)
export class SignedDocumentsExportProcessor extends WorkerHost {
  private readonly logger = new Logger(SignedDocumentsExportProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly r2Client: R2ClientService,
  ) {
    super();
  }

  async process(job: Job<SignedDocumentsExportJobData>): Promise<{ status: string }> {
    return { status: await this.run(job.data.exportId) };
  }

  /** Builds the export unless another run already took it. */
  async run(exportId: string): Promise<string> {
    // Claimed atomically, so a retried or doubled job builds it once.
    const claimed = await this.prismaJobs.signedDocumentExport.updateMany({ where: { id: exportId, status: 'PENDING' }, data: { status: 'RUNNING' } });
    const row = await this.prismaJobs.signedDocumentExport.findUnique({ where: { id: exportId }, select: { schoolId: true, labels: true, status: true } });
    if (!row || claimed.count === 0) return row?.status ?? 'MISSING';

    const objectKey = signedDocumentsExportKey(row.schoolId, exportId);
    try {
      if (!this.r2Client.isConfigured()) throw new Error('R2 is not configured.');
      const { zip, documentCount } = await buildSignedDocumentsZip(this.prismaJobs, this.r2Client, row.schoolId, labelsFrom(row.labels));
      await this.r2Client.putObject(objectKey, zip, 'application/zip');
      const now = new Date();
      await this.prismaJobs.signedDocumentExport.update({
        where: { id: exportId },
        data: {
          status: 'READY',
          objectKey,
          documentCount,
          sizeBytes: zip.length,
          finishedAt: now,
          expiresAt: new Date(now.getTime() + SIGNED_DOCUMENTS_EXPORT_TTL_MS),
        },
      });
      this.logger.log(`signed-documents-export: export ${exportId} for School ${row.schoolId} made with ${documentCount} document(s).`);
      return 'READY';
    } catch (err) {
      this.logger.error(`signed-documents-export: export ${exportId} for School ${row.schoolId} failed — ${String(err)}`);
      await this.prismaJobs.signedDocumentExport.update({
        where: { id: exportId },
        data: { status: 'FAILED', error: String(err).slice(0, 500), finishedAt: new Date() },
      });
      return 'FAILED';
    }
  }
}
