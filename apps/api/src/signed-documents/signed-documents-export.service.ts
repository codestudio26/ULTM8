import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SIGNED_DOCUMENTS_EXPORT_QUEUE } from '../jobs/queue.constants';
import type { SignedDocumentsExportJobData } from '../jobs/signed-documents-export.processor';
import { SIGNED_DOCUMENT_LABEL_DEFAULTS, type SignedDocumentExportDto, type SignedDocumentLabelsDto } from './dto/signed-documents.dto';

const EXPORT_NOT_FOUND = 'Export not found';
const STORAGE_NOT_SET_UP = "File storage isn't set up yet. Try again later.";
/** An export still PENDING or RUNNING after this is taken to have stopped,
 * and a new one may be asked for. */
const STALE_AFTER_MS = 60 * 60 * 1000;

const EXPORT_SELECT = {
  id: true,
  status: true,
  documentCount: true,
  sizeBytes: true,
  objectKey: true,
  createdAt: true,
  finishedAt: true,
  expiresAt: true,
  schoolId: true,
  requestedBy: { select: { firstName: true, surname: true } },
} as const;

type ExportRow = {
  id: string;
  status: SignedDocumentExportDto['status'];
  documentCount: number | null;
  sizeBytes: number | null;
  objectKey: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
  requestedBy: { firstName: string; surname: string } | null;
};

/**
 * Export all signed documents (Decision 315 item 13): the School owner asks
 * for a ZIP of every signed waiver at the School; a background job makes it
 * (SignedDocumentsExportProcessor) into the private R2 bucket, and the owner
 * downloads it through a 5-minute signed link for 24 hours. Owner only (the
 * decision names no staff switch). One export at a time per School.
 */
@Injectable()
export class SignedDocumentsExportService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly r2Client: R2ClientService,
    @InjectQueue(SIGNED_DOCUMENTS_EXPORT_QUEUE) private readonly queue: Queue<SignedDocumentsExportJobData>,
  ) {}

  async request(callerId: string, schoolId: string, labels: SignedDocumentLabelsDto | undefined): Promise<SignedDocumentExportDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    if (!this.r2Client.isConfigured()) throw new ServiceUnavailableException(STORAGE_NOT_SET_UP);

    const inProgress = await this.prismaJobs.signedDocumentExport.findFirst({
      where: { schoolId, status: { in: ['PENDING', 'RUNNING'] }, createdAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } },
      orderBy: { createdAt: 'desc' },
      select: EXPORT_SELECT,
    });
    if (inProgress) return this.toDto(inProgress);

    const stored: Record<string, string> = {};
    for (const key of Object.keys(SIGNED_DOCUMENT_LABEL_DEFAULTS) as Array<keyof SignedDocumentLabelsDto>) {
      const v = labels?.[key];
      if (typeof v === 'string' && v.trim()) stored[key] = v.trim();
    }
    const id = randomUUID();
    const row = await this.prismaJobs.signedDocumentExport.create({
      data: { id, schoolId, requestedById: callerId, labels: stored },
      select: EXPORT_SELECT,
    });
    try {
      await this.queue.add('export', { exportId: id }, { jobId: `signed-documents-export-${id}`, attempts: 1, removeOnComplete: true, removeOnFail: 100 });
    } catch (err) {
      await this.prismaJobs.signedDocumentExport.update({ where: { id }, data: { status: 'FAILED', error: `Could not queue: ${String(err)}`.slice(0, 500) } });
      throw new ConflictException("The export couldn't be started. Try again.");
    }
    return this.toDto(row);
  }

  async latest(callerId: string, schoolId: string): Promise<{ export: SignedDocumentExportDto | null }> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const row = await this.prismaJobs.signedDocumentExport.findFirst({ where: { schoolId }, orderBy: { createdAt: 'desc' }, select: EXPORT_SELECT });
    return { export: row ? this.toDto(row) : null };
  }

  async get(callerId: string, schoolId: string, exportId: string): Promise<SignedDocumentExportDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.toDto(await this.find(schoolId, exportId));
  }

  async downloadUrl(callerId: string, schoolId: string, exportId: string): Promise<{ url: string }> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const row = await this.find(schoolId, exportId);
    if (row.status !== 'READY' || !row.objectKey || (row.expiresAt && row.expiresAt <= new Date())) {
      throw new ConflictException('This export is not ready to download.');
    }
    if (!this.r2Client.isConfigured()) throw new ServiceUnavailableException(STORAGE_NOT_SET_UP);
    const day = row.createdAt.toISOString().slice(0, 10);
    return { url: await this.r2Client.getPresignedFileDownloadUrl(row.objectKey, `signed-documents-${day}.zip`, 'application/zip') };
  }

  private async find(schoolId: string, exportId: string) {
    const row = await this.prismaJobs.signedDocumentExport.findFirst({ where: { id: exportId, schoolId }, select: EXPORT_SELECT });
    if (!row) throw new NotFoundException(EXPORT_NOT_FOUND);
    return row;
  }

  private toDto(r: ExportRow): SignedDocumentExportDto {
    // A READY export past its time reads as EXPIRED before the sweep deletes it.
    const expired = r.status === 'READY' && r.expiresAt !== null && r.expiresAt <= new Date();
    return {
      id: r.id,
      status: expired ? 'EXPIRED' : r.status,
      documentCount: r.documentCount,
      sizeBytes: r.sizeBytes,
      requestedByName: r.requestedBy ? `${r.requestedBy.firstName} ${r.requestedBy.surname}`.trim() : null,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    };
  }
}
