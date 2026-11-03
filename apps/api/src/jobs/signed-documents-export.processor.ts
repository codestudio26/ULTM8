import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { buildSignedDocumentsZip, labelsFrom } from '../signed-documents/signed-documents-builder';
import { addMemberFilesToZip } from '../signed-documents/member-files-export';
import { ZipFileWriter } from '../signed-documents/zip-file-writer';
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
 * the export FAILED, and the owner can ask again. When the owner ticked
 * "Include member files" (Decision 422 item 9) the ZIP also holds every
 * member file at the School, streamed in one at a time; the ZIP is written
 * to a temporary file and uploaded from there, and can be up to 2 GB
 * (ZIP_FILE_MAX_BYTES; a larger one fails).
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
    const row = await this.prismaJobs.signedDocumentExport.findUnique({
      where: { id: exportId },
      select: { schoolId: true, labels: true, status: true, includeMemberFiles: true },
    });
    if (!row || claimed.count === 0) return row?.status ?? 'MISSING';

    const objectKey = signedDocumentsExportKey(row.schoolId, exportId);
    // The ZIP is written to a file of its own, never held in memory whole
    // (member files can make it large), and uploaded from there.
    let dir: string | null = null;
    let zip: ZipFileWriter | null = null;
    try {
      if (!this.r2Client.isConfigured()) throw new Error('R2 is not configured.');
      dir = await mkdtemp(join(tmpdir(), 'signed-documents-export-'));
      const zipPath = join(dir, 'export.zip');
      zip = new ZipFileWriter(zipPath);
      const { documentCount } = await buildSignedDocumentsZip(this.prismaJobs, this.r2Client, row.schoolId, labelsFrom(row.labels), zip);
      // Decision 422 item 9: the owner ticked "Include member files".
      const memberFiles = row.includeMemberFiles ? await addMemberFilesToZip(this.prismaJobs, this.r2Client, row.schoolId, zip, this.logger) : null;
      const sizeBytes = zip.finish();
      await this.r2Client.putObjectFromFile(objectKey, zipPath, 'application/zip');
      const now = new Date();
      await this.prismaJobs.signedDocumentExport.update({
        where: { id: exportId },
        data: {
          status: 'READY',
          objectKey,
          documentCount,
          memberFileCount: memberFiles?.fileCount ?? null,
          sizeBytes,
          finishedAt: now,
          expiresAt: new Date(now.getTime() + SIGNED_DOCUMENTS_EXPORT_TTL_MS),
        },
      });
      const files = memberFiles ? `, ${memberFiles.fileCount} member file(s) (${memberFiles.missingCount} missing from storage)` : '';
      this.logger.log(`signed-documents-export: export ${exportId} for School ${row.schoolId} made with ${documentCount} document(s)${files}.`);
      return 'READY';
    } catch (err) {
      this.logger.error(`signed-documents-export: export ${exportId} for School ${row.schoolId} failed — ${String(err)}`);
      await this.prismaJobs.signedDocumentExport.update({
        where: { id: exportId },
        data: { status: 'FAILED', error: String(err).slice(0, 500), finishedAt: new Date() },
      });
      return 'FAILED';
    } finally {
      zip?.close();
      if (dir) await rm(dir, { recursive: true, force: true }).catch((err) => this.logger.warn(`signed-documents-export: could not remove ${dir} — ${String(err)}`));
    }
  }
}
