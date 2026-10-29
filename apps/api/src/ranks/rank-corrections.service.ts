import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RankCorrectionRequest } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GradingService } from './grading.service';
import { CreateRankCorrectionDto, RankCorrectionDto, RankCorrectionListQueryDto } from './dto/rank-correction.dto';
import { CORRECTION_ANSWERED, CORRECTION_NOT_VERIFIED, CORRECTION_PENDING, CORRECTION_SAME_RANK } from './rank-correction-rules';

/**
 * Backlog 3.13 (Decisions 286, 299): a student asks the School to correct
 * their belt. Students never change their own rank: a reviewer — the owner,
 * or a coach with "Verify ranks" for the style who covers the student's
 * branch, as for declared belts (Decisions 137, 147, 189) — approves it, which
 * moves the student through GradingService with a RANK_CORRECTION history
 * entry, or rejects it.
 *
 * Requests are read and written on the jobs connection, after these checks:
 * a student only ever reaches their own; reviewers go through the grading
 * permission checks for each request's style and student.
 */
@Injectable()
export class RankCorrectionsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly grading: GradingService,
  ) {}

  // ---------------------------------------------------------------------------
  // The student
  // ---------------------------------------------------------------------------

  async create(callerId: string, dto: CreateRankCorrectionDto): Promise<RankCorrectionDto> {
    // Their own rank in the style, read as themselves, at a School they still belong to.
    const own = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const sr = await tx.studentRank.findUnique({ where: { studentId_disciplineId: { studentId: callerId, disciplineId: dto.disciplineId } } });
      if (!sr) return null;
      const grant = await tx.roleGrant.findFirst({ where: { userId: callerId, schoolId: sr.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
      return grant ? sr : null;
    });
    if (!own) {
      throw new NotFoundException('Discipline not found');
    }
    if (own.verificationStatus !== 'VERIFIED') {
      throw new ConflictException(CORRECTION_NOT_VERIFIED);
    }
    const tier = await this.prismaJobs.rankStripeTier.findFirst({
      where: { id: dto.stripeTierId, rank: { disciplineId: dto.disciplineId, archivedAt: null } },
      select: { id: true, rankId: true },
    });
    if (!tier) {
      throw new BadRequestException('stripeTierId must be a grade on this style\'s ladder.');
    }
    if (tier.id === own.currentStripeId) {
      throw new BadRequestException(CORRECTION_SAME_RANK);
    }
    try {
      const row = await this.prismaJobs.rankCorrectionRequest.create({
        data: {
          id: randomUUID(),
          schoolId: own.schoolId,
          studentId: callerId,
          disciplineId: dto.disciplineId,
          fromRankId: own.currentRankId,
          fromStripeTierId: own.currentStripeId,
          requestedRankId: tier.rankId,
          requestedStripeTierId: dto.stripeTierId,
          note: dto.note,
        },
      });
      return (await this.describe([row]))[0];
    } catch (e) {
      // The partial unique index: one waiting request per student and style.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(CORRECTION_PENDING);
      }
      throw e;
    }
  }

  /** The caller's own requests, newest first. */
  async mine(callerId: string): Promise<{ items: RankCorrectionDto[] }> {
    const rows = await this.prismaJobs.rankCorrectionRequest.findMany({ where: { studentId: callerId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: await this.describe(rows) };
  }

  // ---------------------------------------------------------------------------
  // Reviewers
  // ---------------------------------------------------------------------------

  /** Requests a caller may answer at a School: waiting ones oldest first, or
   * the newest 50 answered. The owner sees every student's; a coach those in
   * the styles they may verify, for the students they cover. */
  async list(callerId: string, schoolId: string, query: RankCorrectionListQueryDto): Promise<{ items: RankCorrectionDto[] }> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const answered = query.status === 'ANSWERED';
    const rows = await this.prismaJobs.rankCorrectionRequest.findMany({
      where: { schoolId, ...(query.studentId ? { studentId: query.studentId } : {}), ...(answered ? { status: { not: 'PENDING' } } : { status: 'PENDING' }) },
      orderBy: answered ? { reviewedAt: 'desc' } : { createdAt: 'asc' },
      take: answered ? 50 : 500,
    });
    const allowed: RankCorrectionRequest[] = [];
    const verdicts = new Map<string, boolean>();
    for (const row of rows) {
      const key = `${row.disciplineId}:${row.studentId}`;
      if (!verdicts.has(key)) {
        verdicts.set(
          key,
          await this.grading.assertCanGrade(callerId, schoolId, row.disciplineId, row.studentId, 'canVerifyRanks').then(
            () => true,
            () => false,
          ),
        );
      }
      if (verdicts.get(key)) allowed.push(row);
    }
    return { items: await this.describe(allowed) };
  }

  async approve(callerId: string, id: string, note: string | null): Promise<RankCorrectionDto> {
    const request = await this.reviewable(callerId, id);
    const claimed = await this.claim(callerId, request, 'APPROVED', note);
    try {
      await this.grading.applyRequestedCorrection(callerId, request, note);
    } catch (e) {
      // Not applied: the request waits again.
      await this.prismaJobs.rankCorrectionRequest.updateMany({
        where: { id, status: 'APPROVED', reviewedById: callerId },
        data: { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null },
      });
      throw e;
    }
    return (await this.describe([claimed]))[0];
  }

  async reject(callerId: string, id: string, note: string | null): Promise<RankCorrectionDto> {
    const request = await this.reviewable(callerId, id);
    const claimed = await this.claim(callerId, request, 'REJECTED', note);
    return (await this.describe([claimed]))[0];
  }

  /** The request, once the caller is shown to be one of its reviewers. */
  private async reviewable(callerId: string, id: string): Promise<RankCorrectionRequest> {
    const request = await this.prismaJobs.rankCorrectionRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Correction request not found');
    }
    await this.grading.assertCanReviewCorrection(callerId, request.schoolId, request.disciplineId, request.studentId);
    if (request.status !== 'PENDING') {
      throw new ConflictException(CORRECTION_ANSWERED);
    }
    return request;
  }

  /** Answers it, only from PENDING: two reviewers at once get 409, not two answers. */
  private async claim(callerId: string, request: RankCorrectionRequest, status: 'APPROVED' | 'REJECTED', note: string | null) {
    const reviewedAt = new Date();
    const done = await this.prismaJobs.rankCorrectionRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status, reviewedById: callerId, reviewedAt, reviewNote: note },
    });
    if (done.count === 0) {
      throw new ConflictException(CORRECTION_ANSWERED);
    }
    return { ...request, status, reviewedById: callerId, reviewedAt, reviewNote: note };
  }

  /** Names for the rows: the student, the style, and both rungs. Read on the
   * jobs connection for rows the caller has already been allowed to see. */
  private async describe(rows: RankCorrectionRequest[]): Promise<RankCorrectionDto[]> {
    if (rows.length === 0) return [];
    const rankIds = [...new Set(rows.flatMap((r) => [r.fromRankId, r.requestedRankId]))];
    const tierIds = [...new Set(rows.flatMap((r) => [r.fromStripeTierId, r.requestedStripeTierId]).filter((t): t is string => !!t))];
    const [students, disciplines, ranks, tiers] = await Promise.all([
      this.prismaJobs.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, surname: true } }),
      this.prismaJobs.discipline.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.disciplineId))] } }, select: { id: true, name: true } }),
      this.prismaJobs.rank.findMany({ where: { id: { in: rankIds } }, select: { id: true, name: true } }),
      this.prismaJobs.rankStripeTier.findMany({ where: { id: { in: tierIds } }, select: { id: true, name: true } }),
    ]);
    const student = new Map(students.map((u) => [u.id, u]));
    const discipline = new Map(disciplines.map((d) => [d.id, d.name]));
    const rank = new Map(ranks.map((r) => [r.id, r.name]));
    const tier = new Map(tiers.map((t) => [t.id, t.name]));
    const rung = (rankId: string, stripeTierId: string | null) => ({
      rankId,
      rankName: rank.get(rankId) ?? '',
      stripeTierId,
      stripeName: stripeTierId ? tier.get(stripeTierId) ?? null : null,
    });
    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      studentId: r.studentId,
      firstName: student.get(r.studentId)?.firstName ?? '',
      surname: student.get(r.studentId)?.surname ?? '',
      disciplineId: r.disciplineId,
      disciplineName: discipline.get(r.disciplineId) ?? '',
      from: rung(r.fromRankId, r.fromStripeTierId),
      requested: rung(r.requestedRankId, r.requestedStripeTierId),
      note: r.note,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    }));
  }
}
