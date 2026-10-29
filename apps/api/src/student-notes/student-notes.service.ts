import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import type { CreateStudentNoteDto, UpdateStudentNoteDto } from './dto/student-note.dto';

const NOTE_NOT_FOUND = 'Note not found';
const NOT_YOURS = "Only the note's author or a School owner can change it.";

type NoteRow = {
  id: string;
  body: string;
  showToMember: boolean;
  authorId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  author: { firstName: string; surname: string } | null;
};

const NOTE_SELECT = {
  id: true,
  body: true,
  showToMember: true,
  authorId: true,
  createdAt: true,
  editedAt: true,
  author: { select: { firstName: true, surname: true } },
} as const;

const authorName = (n: NoteRow) => (n.author ? `${n.author.firstName} ${n.author.surname}`.trim() : null);

/**
 * Staff notes on a student (backlog 3.10; Decision 315 item 8, Decision 400).
 * Any staff who cover the student read every note and add new ones; only a
 * note's author or a School owner edits or deletes it. A note ticked "Show to
 * member" is also shown to the student in the app (a child's to their
 * Guardian). Notes are kept while the student's account exists and erased
 * with it. Read and written on the jobs connection after these checks.
 */
@Injectable()
export class StudentNotesService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardians: GuardiansService,
  ) {}

  async list(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    const owner = await this.tenantAuth.isSchoolOwner(callerId, schoolId);
    const rows = await this.prismaJobs.studentNote.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: 'desc' }, select: NOTE_SELECT });
    return { items: rows.map((n) => this.toDto(n, callerId, owner)) };
  }

  async create(callerId: string, schoolId: string, studentId: string, dto: CreateStudentNoteDto) {
    await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const row = await this.prismaJobs.studentNote.create({
      data: { id: randomUUID(), schoolId, studentId, authorId: callerId, body: dto.body, showToMember: dto.showToMember ?? false },
      select: NOTE_SELECT,
    });
    return this.toDto(row, callerId, await this.tenantAuth.isSchoolOwner(callerId, schoolId));
  }

  async update(callerId: string, schoolId: string, studentId: string, noteId: string, dto: UpdateStudentNoteDto) {
    const owner = await this.assertMayChange(callerId, schoolId, studentId, noteId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const row = await this.prismaJobs.studentNote.update({
      where: { id: noteId },
      data: {
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.showToMember !== undefined ? { showToMember: dto.showToMember } : {}),
        editedAt: new Date(),
      },
      select: NOTE_SELECT,
    });
    return this.toDto(row, callerId, owner);
  }

  async remove(callerId: string, schoolId: string, studentId: string, noteId: string) {
    await this.assertMayChange(callerId, schoolId, studentId, noteId);
    await this.prismaJobs.studentNote.delete({ where: { id: noteId } });
  }

  /** GET /student-notes/me: the notes shown to the caller, or to their
   * Guardian-linked child, from every School. */
  async mine(callerId: string, studentId?: string) {
    const target = studentId ?? callerId;
    if (target !== callerId) await this.guardians.assertGuardianOfStudent(callerId, target);
    const rows = await this.prismaJobs.studentNote.findMany({
      where: { studentId: target, showToMember: true },
      orderBy: { createdAt: 'desc' },
      select: { ...NOTE_SELECT, schoolId: true, school: { select: { name: true } } },
    });
    // Only Schools the student is still enrolled at.
    const enrolled = new Set(
      (
        await this.prismaJobs.roleGrant.findMany({
          where: { userId: target, role: 'STUDENT', revokedAt: null, schoolId: { in: [...new Set(rows.map((r) => r.schoolId))] } },
          select: { schoolId: true },
        })
      ).map((g) => g.schoolId),
    );
    return {
      items: rows
        .filter((r) => enrolled.has(r.schoolId))
        .map((r) => ({ id: r.id, schoolId: r.schoolId, schoolName: r.school.name, body: r.body, authorName: authorName(r), createdAt: r.createdAt.toISOString() })),
    };
  }

  /** Staff who cover the student, and the note's author or an owner. Returns
   * whether the caller is an owner. */
  private async assertMayChange(callerId: string, schoolId: string, studentId: string, noteId: string): Promise<boolean> {
    await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    const note = await this.prismaJobs.studentNote.findFirst({ where: { id: noteId, schoolId, studentId }, select: { authorId: true } });
    if (!note) throw new NotFoundException(NOTE_NOT_FOUND);
    const owner = await this.tenantAuth.isSchoolOwner(callerId, schoolId);
    if (!owner && note.authorId !== callerId) throw new ForbiddenException(NOT_YOURS);
    return owner;
  }

  private toDto(n: NoteRow, callerId: string, owner: boolean) {
    return {
      id: n.id,
      body: n.body,
      showToMember: n.showToMember,
      authorName: authorName(n),
      authorId: n.authorId,
      createdAt: n.createdAt.toISOString(),
      editedAt: n.editedAt?.toISOString() ?? null,
      canEdit: owner || n.authorId === callerId,
    };
  }
}
