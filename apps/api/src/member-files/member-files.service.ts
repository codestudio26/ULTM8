import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { MEMBER_FILE_MAX_BYTES, cleanMemberFileName, memberFileExtension, memberFileTypeOf } from './member-file-type';

/** What the upload endpoint hands over from the multipart body. */
export type UploadedMemberFile = { buffer: Buffer; originalname: string; size: number };

const FILE_NOT_FOUND = 'File not found';
const STORAGE_NOT_SET_UP = "File storage isn't set up yet. Try again later.";

const FILE_SELECT = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  objectKey: true,
  createdAt: true,
  uploadedBy: { select: { firstName: true, surname: true } },
} as const;

type FileRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedBy: { firstName: string; surname: string } | null;
};

/**
 * Files on a member (backlog 5.11; Decision 315 item 9): PDF, JPG and PNG, up
 * to 10 MB each, seen by the School's owners and the Branch Staff they let
 * manage member files (for their own branches' students); never shown to the
 * member: no member-facing endpoint reads this table, and the app connection
 * has no grant on it. The file goes through the API so its type is read from
 * its content and its size checked, then into the private R2 bucket; a
 * download is a 5-minute signed link, never a public URL. Erased with the
 * account and with a purged School (EntityOffboardingPurgeProcessor,
 * TenantLifecyclePurgeProcessor).
 */
@Injectable()
export class MemberFilesService {
  private readonly logger = new Logger(MemberFilesService.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly r2Client: R2ClientService,
  ) {}

  async list(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertMayManageMemberFiles(callerId, schoolId, studentId);
    const rows = await this.prismaJobs.memberFile.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: 'desc' }, select: FILE_SELECT });
    return { items: rows.map((r) => this.toDto(r)) };
  }

  async upload(callerId: string, schoolId: string, studentId: string, file: UploadedMemberFile | undefined) {
    await this.tenantAuth.assertMayManageMemberFiles(callerId, schoolId, studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const enrolled = await this.prismaJobs.roleGrant.findFirst({
      where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    if (!enrolled) throw new NotFoundException('This person is not a Student at this School.');
    if (!file || file.size === 0) throw new BadRequestException('Choose a file to upload.');
    if (file.size > MEMBER_FILE_MAX_BYTES || file.buffer.length > MEMBER_FILE_MAX_BYTES) {
      throw new BadRequestException('A file can be up to 10 MB.');
    }
    const fileName = cleanMemberFileName(file.originalname);
    const contentType = memberFileTypeOf(file.buffer, fileName);
    if (!contentType) throw new BadRequestException('Only PDF, JPG and PNG files can be uploaded.');
    if (!this.r2Client.isConfigured()) throw new ServiceUnavailableException(STORAGE_NOT_SET_UP);

    const id = randomUUID();
    const objectKey = `member-files/${schoolId}/${studentId}/${id}.${memberFileExtension(contentType)}`;
    await this.r2Client.putObject(objectKey, file.buffer, contentType);
    try {
      const row = await this.prismaJobs.memberFile.create({
        data: { id, schoolId, studentId, uploadedById: callerId, fileName, contentType, sizeBytes: file.buffer.length, objectKey },
        select: FILE_SELECT,
      });
      return this.toDto(row);
    } catch (err) {
      // No row, so the stored file would have nothing pointing at it.
      await this.r2Client
        .deleteObject(objectKey)
        .catch((cleanupErr) => this.logger.error(`Member file ${objectKey} was stored but not recorded, and could not be removed — ${String(cleanupErr)}`));
      throw err;
    }
  }

  async downloadUrl(callerId: string, schoolId: string, studentId: string, fileId: string) {
    await this.tenantAuth.assertMayManageMemberFiles(callerId, schoolId, studentId);
    const row = await this.findFile(schoolId, studentId, fileId);
    if (!this.r2Client.isConfigured()) throw new ServiceUnavailableException(STORAGE_NOT_SET_UP);
    return { url: await this.r2Client.getPresignedFileDownloadUrl(row.objectKey, row.fileName, row.contentType) };
  }

  /** The stored file goes first: if that fails the row stays, so a retry
   * deletes both and no file is left without a record (the purge job's
   * rule for a signature's drawn image). */
  async remove(callerId: string, schoolId: string, studentId: string, fileId: string) {
    await this.tenantAuth.assertMayManageMemberFiles(callerId, schoolId, studentId);
    const row = await this.findFile(schoolId, studentId, fileId);
    await this.deleteStoredFile(row.id, row.objectKey);
    await this.prismaJobs.memberFile.deleteMany({ where: { id: row.id } });
  }

  private async deleteStoredFile(id: string, objectKey: string) {
    if (!this.r2Client.isConfigured()) {
      this.logger.warn(`R2 is not configured, so the stored copy of member file ${id} was not deleted.`);
      return;
    }
    try {
      await this.r2Client.deleteObject(objectKey);
    } catch (err) {
      this.logger.error(`Member file ${id} could not be deleted from storage — ${String(err)}`);
      throw new ServiceUnavailableException("The file couldn't be deleted. Try again.");
    }
  }

  private async findFile(schoolId: string, studentId: string, fileId: string) {
    const row = await this.prismaJobs.memberFile.findFirst({ where: { id: fileId, schoolId, studentId }, select: FILE_SELECT });
    if (!row) throw new NotFoundException(FILE_NOT_FOUND);
    return row;
  }

  private toDto(r: FileRow) {
    return {
      id: r.id,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      uploadedByName: r.uploadedBy ? `${r.uploadedBy.firstName} ${r.uploadedBy.surname}`.trim() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
