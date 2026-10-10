import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { RanksService } from './ranks.service';
import { DeclareInstructorBeltDto, VerifyInstructorBeltDto } from './dto/instructor-belt.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BELT_INCLUDE = {
  user: { select: { firstName: true, surname: true } },
  discipline: { select: { name: true } },
  stripeTier: { select: { name: true } },
} as const;
type BeltRow = Prisma.InstructorBeltGetPayload<{ include: typeof BELT_INCLUDE }>;

/**
 * An instructor's own belt per style (Decisions 108, 188): the instructor
 * chooses a belt and stripe from the style's ladder at their School, and it
 * stays unverified until the School Owner verifies or corrects it. Changing
 * it again makes it unverified again. RLS backs every rule here: the owner
 * manages all rows of their School; an instructor only their own, and only
 * as unverified (20261028000000_instructor_belts).
 */
@Injectable()
export class InstructorBeltsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly ranksService: RanksService,
  ) {}

  /** The caller's own belts at this School. Instructors only. */
  async findMine(callerId: string, schoolId: string) {
    this.assertUuids(schoolId);
    await this.assertActiveInstructor(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.instructorBelt.findMany({ where: { schoolId, userId: callerId }, include: BELT_INCLUDE }),
    );
    return { items: this.sorted(rows).map(toResponse) };
  }

  /** The instructor chooses (or changes) their belt in one style. Always
   * unverified afterwards, unless it is the very belt already verified. */
  async declareMine(callerId: string, schoolId: string, disciplineId: string, dto: DeclareInstructorBeltDto) {
    this.assertUuids(schoolId, disciplineId);
    await this.assertActiveInstructor(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.ranksService.assertRanksEnabled(callerId, schoolId);
    const row = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await this.assertBeltOfStyle(tx, schoolId, disciplineId, dto.rankId, dto.stripeTierId);
      const existing = await tx.instructorBelt.findUnique({ where: { userId_disciplineId: { userId: callerId, disciplineId } } });
      if (existing && existing.rankId === dto.rankId && existing.stripeTierId === dto.stripeTierId) {
        return tx.instructorBelt.findUniqueOrThrow({ where: { id: existing.id }, include: BELT_INCLUDE });
      }
      const unverified = { rankId: dto.rankId, stripeTierId: dto.stripeTierId, verificationStatus: 'UNVERIFIED' as const, verifiedAt: null, verifiedById: null, declaredAt: new Date() };
      return existing
        ? tx.instructorBelt.update({ where: { id: existing.id }, data: unverified, include: BELT_INCLUDE })
        : tx.instructorBelt.create({ data: { id: randomUUID(), schoolId, userId: callerId, disciplineId, ...unverified }, include: BELT_INCLUDE });
    });
    return toResponse(row);
  }

  /** The owner's view: every instructor's belts at the School, and who the
   * active instructors are (some may not have chosen yet). */
  async findAllForSchool(callerId: string, schoolId: string) {
    this.assertUuids(schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rows = await tx.instructorBelt.findMany({ where: { schoolId }, include: BELT_INCLUDE });
      const grants = await tx.roleGrant.findMany({
        where: { schoolId, role: 'INSTRUCTOR', revokedAt: null },
        distinct: ['userId'],
        select: { userId: true, user: { select: { firstName: true, surname: true } } },
      });
      const instructors = grants
        .map((g) => ({ userId: g.userId, firstName: g.user.firstName, surname: g.user.surname }))
        .sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
      return { items: this.sorted(rows).map(toResponse), instructors };
    });
  }

  /** The owner verifies an instructor's belt as chosen, or corrects it to
   * another belt of the style (verified at once). */
  async verify(callerId: string, schoolId: string, userId: string, disciplineId: string, dto: VerifyInstructorBeltDto) {
    this.assertUuids(schoolId, userId, disciplineId);
    if ((dto.rankId === undefined) !== (dto.stripeTierId === undefined)) {
      throw new BadRequestException('To correct the belt, send both rankId and stripeTierId.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.ranksService.assertRanksEnabled(callerId, schoolId);
    const row = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const existing = await tx.instructorBelt.findUnique({ where: { userId_disciplineId: { userId, disciplineId } } });
      if (!existing || existing.schoolId !== schoolId) {
        throw new NotFoundException('This instructor hasn\'t chosen a belt in this style yet.');
      }
      const target = dto.rankId && dto.stripeTierId ? { rankId: dto.rankId, stripeTierId: dto.stripeTierId } : { rankId: existing.rankId, stripeTierId: existing.stripeTierId };
      if (dto.rankId && dto.stripeTierId) await this.assertBeltOfStyle(tx, schoolId, disciplineId, target.rankId, target.stripeTierId);
      const corrected = target.rankId !== existing.rankId || target.stripeTierId !== existing.stripeTierId;
      if (!corrected && existing.verificationStatus === 'VERIFIED') {
        throw new ConflictException('This belt is already verified.');
      }
      // Conditional on what was read: if the instructor changed it meanwhile,
      // the owner sees a 409 rather than verifying a belt they didn't look at.
      const updated = await tx.instructorBelt.updateMany({
        where: { id: existing.id, rankId: existing.rankId, stripeTierId: existing.stripeTierId, verificationStatus: existing.verificationStatus },
        data: { ...target, verificationStatus: 'VERIFIED', verifiedAt: new Date(), verifiedById: callerId },
      });
      if (updated.count === 0) {
        throw new ConflictException('This belt was changed at the same time — please look again.');
      }
      return tx.instructorBelt.findUniqueOrThrow({ where: { id: existing.id }, include: BELT_INCLUDE });
    });
    return toResponse(row);
  }

  private async assertActiveInstructor(callerId: string, schoolId: string) {
    const grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: callerId, schoolId, role: 'INSTRUCTOR', revokedAt: null }, select: { id: true } }),
    );
    if (!grant) throw new ForbiddenException('Only instructors at this School choose their own belt.');
  }

  private async assertBeltOfStyle(tx: Prisma.TransactionClient, schoolId: string, disciplineId: string, rankId: string, stripeTierId: string) {
    const discipline = await tx.discipline.findUnique({ where: { id: disciplineId }, select: { schoolId: true } });
    if (!discipline || discipline.schoolId !== schoolId) throw new NotFoundException('Style not found');
    const tier = await tx.rankStripeTier.findFirst({ where: { id: stripeTierId, rankId, rank: { disciplineId } }, select: { id: true } });
    if (!tier) throw new BadRequestException('rankId and stripeTierId must be a belt of this style and one of its stripes.');
  }

  private assertUuids(...ids: string[]) {
    if (ids.some((id) => !UUID_PATTERN.test(id))) throw new BadRequestException('Ids must be valid UUIDs');
  }

  private sorted(rows: BeltRow[]) {
    return [...rows].sort(
      (a, b) => `${a.user.firstName} ${a.user.surname}`.localeCompare(`${b.user.firstName} ${b.user.surname}`) || a.discipline.name.localeCompare(b.discipline.name),
    );
  }
}

function toResponse(r: BeltRow) {
  return {
    id: r.id,
    userId: r.userId,
    firstName: r.user.firstName,
    surname: r.user.surname,
    disciplineId: r.disciplineId,
    disciplineName: r.discipline.name,
    rankId: r.rankId,
    stripeTierId: r.stripeTierId,
    beltName: r.stripeTier.name,
    verificationStatus: r.verificationStatus as 'UNVERIFIED' | 'VERIFIED',
    declaredAt: r.declaredAt,
    verifiedAt: r.verifiedAt,
  };
}
