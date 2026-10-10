import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { CreateRankDto, RankStripeTierInputDto } from './dto/create-rank.dto';
import { UpdateRankDto } from './dto/update-rank.dto';
import { ReorderRanksDto } from './dto/ladder.dto';
import { CreateStyleFromTemplateDto } from './dto/style-template.dto';
import { buildIbjjfTemplate, IBJJF_CLASS_TYPES, TEMPLATES } from './templates/ibjjf';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

/** The one include every Rank read uses, so shapeRankResponse() always gets
 * stripe tiers (in ladder order) with their per-rung required Skills. */
/** Ladder edits of one style take turns (stress round, finding 4): two edits
 * listing the same belts or rungs in different orders otherwise lock rows in
 * opposite orders and deadlock. Locks the style's row until the transaction
 * ends. */
async function lockLadder(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, disciplineId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Discipline" WHERE "id" = ${disciplineId} FOR UPDATE`;
}

const RANK_INCLUDE = {
  stripeTiers: { orderBy: { order: 'asc' as const }, include: { requiredSkills: true } },
  requiredSkills: true,
} satisfies Prisma.RankInclude;

/**
 * Phase 10b scope only: Discipline/Rank/Skill catalog CRUD (School Owner/Manager
 * only). See RANKS.md / the Phase 10b kickoff prompt for the full scoping
 * rationale — bulk-grading, the readiness-bucket/progress-% computation, and
 * Booking-time rank-gating enforcement are all out of scope (see
 * GradingService's own header comment for grading-action scope).
 *
 * CRUD /schools/{id}/disciplines is a Developer-level addition (see
 * CreateDisciplineDto's own comment) — Spec 55's own confirmed endpoint table
 * never names how a Discipline itself gets created, only Rank CRUD nested under
 * an assumed-existing one.
 */
@Injectable()
export class RanksService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Discipline CRUD
  // ---------------------------------------------------------------------------

  async createDiscipline(callerId: string, schoolId: string, dto: CreateDisciplineDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.assertRanksEnabled(callerId, schoolId);

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.create({
        data: { id, schoolId, name: dto.name, classTypesOffered: dto.classTypesOffered ?? [], skillsRequiredToGrade: dto.skillsRequiredToGrade ?? false },
      }),
    );
  }

  /** The ladder templates a style can start from (Decision 131). */
  listTemplates() {
    return { items: TEMPLATES.map((t) => ({ ...t, rungs: buildIbjjfTemplate(t.id).reduce((sum, b) => sum + b.rungs.length, 0) })) };
  }

  /** A new style from an IBJJF template (Decisions 131, 182): the prototype's
   * belts, rungs, numbers and class types, as the school's own copy to edit
   * freely. Owner only, like every ladder edit. */
  async createFromTemplate(callerId: string, schoolId: string, dto: CreateStyleFromTemplateDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.assertRanksEnabled(callerId, schoolId);
    const template = TEMPLATES.find((t) => t.id === dto.templateId)!;
    const belts = buildIbjjfTemplate(dto.templateId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const discipline = await tx.discipline.create({
        data: { id: randomUUID(), schoolId, name: dto.name ?? template.name, classTypesOffered: [...IBJJF_CLASS_TYPES] },
      });
      for (const [order, belt] of belts.entries()) {
        const rankId = randomUUID();
        await tx.rank.create({
          data: {
            id: rankId,
            disciplineId: discipline.id,
            schoolId,
            order,
            name: belt.name,
            primaryColour: belt.primaryColour,
            secondaryColour: belt.secondaryColour,
            tagColour: belt.tagColour,
            coralAccent: belt.coralAccent,
            yearsInRankFlag: belt.rungs.some((r) => r.timeOnly),
          },
        });
        await tx.rankStripeTier.createMany({
          data: belt.rungs.map((r, i) => ({
            id: randomUUID(),
            rankId,
            schoolId,
            order: i,
            name: r.name,
            count: r.segments.reduce((sum, seg) => sum + seg.count, 0),
            colour: r.segments[0]?.colour ?? '#FFFFFF',
            stripeSegments: r.segments,
            timeOnly: r.timeOnly,
            classesRequired: r.classesRequired,
            minimumDaysInRank: r.minimumDaysInRank,
            weeklyClassCountCap: r.weeklyClassCountCap,
            eligibleClassTypes: r.eligibleClassTypes,
          })),
        });
      }
      return discipline;
    });
  }

  /** Duplicate a style (Decision 182, prototype duplicateStyle): its belts and
   * rungs with all their rules, its skills (re-linked to the copied rungs),
   * class types, "skills required" switch and board %. Not its students, their
   * ranks, lesson links or coach permissions. Named "… (Copy)". Owner only. */
  async duplicateDiscipline(callerId: string, disciplineId: string) {
    const source = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, source.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, source.schoolId);
    await this.assertRanksEnabled(callerId, source.schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const copy = await tx.discipline.create({
        data: {
          id: randomUUID(),
          schoolId: source.schoolId,
          name: `${source.name} (Copy)`,
          classTypesOffered: source.classTypesOffered,
          skillsRequiredToGrade: source.skillsRequiredToGrade,
          boardGettingThere: source.boardGettingThere,
          boardReadyToGrade: source.boardReadyToGrade,
        },
      });
      const skillMap = new Map<string, string>();
      for (const skill of await tx.skill.findMany({ where: { disciplineId } })) {
        const id = randomUUID();
        skillMap.set(skill.id, id);
        await tx.skill.create({ data: { id, disciplineId: copy.id, schoolId: source.schoolId, name: skill.name, description: skill.description } });
      }
      const ranks = await tx.rank.findMany({ where: { disciplineId }, include: RANK_INCLUDE, orderBy: { order: 'asc' } });
      for (const rank of ranks) {
        const { id: _id, disciplineId: _d, createdAt: _c, updatedAt: _u, stripeTiers, requiredSkills, ...rankFields } = rank;
        const rankId = randomUUID();
        await tx.rank.create({ data: { ...rankFields, id: rankId, disciplineId: copy.id } });
        const beltSkills = requiredSkills.map((r) => skillMap.get(r.skillId)).filter((id): id is string => !!id);
        if (beltSkills.length) await tx.rankRequiredSkill.createMany({ data: beltSkills.map((skillId) => ({ rankId, skillId })) });
        for (const tier of stripeTiers) {
          const { id: _tid, rankId: _r, createdAt: _tc, updatedAt: _tu, requiredSkills: tierSkills, ...tierFields } = tier;
          const tierId = randomUUID();
          await tx.rankStripeTier.create({
            data: {
              ...tierFields,
              id: tierId,
              rankId,
              stripeSegments: tierFields.stripeSegments as Prisma.InputJsonValue,
              classTypeRequirements: tierFields.classTypeRequirements as Prisma.InputJsonValue,
            },
          });
          const ids = tierSkills.map((r) => skillMap.get(r.skillId)).filter((id): id is string => !!id);
          if (ids.length) await tx.rankStripeTierRequiredSkill.createMany({ data: ids.map((skillId) => ({ stripeTierId: tierId, skillId })) });
        }
      }
      return copy;
    });
  }

  async findAllDisciplines(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
    );
  }

  async findOneDiscipline(callerId: string, disciplineId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!found) {
      throw new NotFoundException('Discipline not found');
    }
    return found;
  }

  async updateDiscipline(callerId: string, disciplineId: string, dto: UpdateDisciplineDto) {
    const existing = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.update({ where: { id: disciplineId }, data: { name: dto.name, classTypesOffered: dto.classTypesOffered, skillsRequiredToGrade: dto.skillsRequiredToGrade } }),
    );
  }

  /** Deleting (Decision 198): only what has never been used. A style goes only
   * when nobody has ever held a rank in it, no instructor has declared a belt
   * in it, and no class, timetable slot or lesson uses it; its belts, skills
   * and coach permissions go with it, and it is taken off membership plans and
   * instructors' styles. Owner only. */
  async deleteDiscipline(callerId: string, disciplineId: string): Promise<void> {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await lockLadder(tx, disciplineId);
      const students = await tx.studentRank.count({ where: { disciplineId } });
      if (students > 0) throw new ConflictException(`${students} student${students === 1 ? ' has' : 's have'} a rank in this style, so it can't be deleted.`);
      const instructors = await tx.instructorBelt.count({ where: { disciplineId } });
      if (instructors > 0) throw new ConflictException('An instructor has declared their belt in this style, so it can\'t be deleted.');
      const styleJson = JSON.stringify([{ disciplineId }]);
      const [{ n: classes }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Class" WHERE "schoolId" = ${discipline.schoolId} AND "styles" @> ${styleJson}::jsonb`;
      const [{ n: slots }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "TimetableSlot" WHERE "schoolId" = ${discipline.schoolId} AND "styles" @> ${styleJson}::jsonb`;
      if (classes + slots > 0) throw new ConflictException('Classes or timetable slots use this style. Change or remove them first.');
      const skills = await tx.skill.findMany({ where: { disciplineId }, select: { id: true } });
      const skillIds = skills.map((sk) => sk.id);
      const lessons = await tx.lessonSkill.count({ where: { skillId: { in: skillIds } } });
      if (lessons > 0) throw new ConflictException('Lessons use this style\'s skills. Change or delete those lessons first.');

      await tx.gradingPermission.deleteMany({ where: { disciplineId } });
      await tx.rankRequiredSkill.deleteMany({ where: { skillId: { in: skillIds } } });
      await tx.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: { in: skillIds } } });
      await tx.skill.deleteMany({ where: { disciplineId } });
      const belts = await tx.rank.findMany({ where: { disciplineId }, select: { id: true } });
      await tx.rankRequiredSkill.deleteMany({ where: { rankId: { in: belts.map((b) => b.id) } } });
      await tx.rankStripeTier.deleteMany({ where: { rankId: { in: belts.map((b) => b.id) } } });
      await tx.rank.deleteMany({ where: { disciplineId } });
      // Taken off the plans and instructors that listed it (an unticked box).
      const plans = await tx.membershipPlan.findMany({ where: { schoolId: discipline.schoolId, disciplineIds: { has: disciplineId } }, select: { id: true, disciplineIds: true } });
      for (const plan of plans) {
        await tx.membershipPlan.update({ where: { id: plan.id }, data: { disciplineIds: plan.disciplineIds.filter((d) => d !== disciplineId) } });
      }
      const instructorRows = await tx.instructor.findMany({
        where: { schoolId: discipline.schoolId, specializationStyleIds: { has: disciplineId } },
        select: { id: true, specializationStyleIds: true, specializations: true },
      });
      for (const ins of instructorRows) {
        await tx.instructor.update({
          where: { id: ins.id },
          data: { specializationStyleIds: ins.specializationStyleIds.filter((d) => d !== disciplineId), specializations: ins.specializations.filter((n) => n !== discipline.name) },
        });
      }
      await tx.discipline.delete({ where: { id: disciplineId } });
    });
  }

  // ---------------------------------------------------------------------------
  // Rank CRUD (with nested stripe tiers) — School Owner/Manager only.
  // ---------------------------------------------------------------------------

  async createRank(callerId: string, disciplineId: string, dto: CreateRankDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertContiguousStripeTiers(dto.stripeTiers.map((t) => t.order));
    if (dto.stripeTiers.some((t) => t.id !== undefined)) {
      throw new BadRequestException('A new belt has only new stripes; stripe ids are for updating a belt.');
    }

    const existingOrders = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findMany({ where: { disciplineId }, select: { order: true }, orderBy: { order: 'asc' } }),
    );
    this.assertContiguousOrder(existingOrders.map((r) => r.order), dto.order);

    if (dto.requiredSkillIds?.length) {
      await this.assertSkillsBelongToDiscipline(callerId, dto.requiredSkillIds, disciplineId);
    }
    await this.assertTierSkillsBelongToDiscipline(callerId, dto.stripeTiers, disciplineId);
    const rankName = dto.name ?? `Belt ${dto.order + 1}`;
    const tierData = dto.stripeTiers.map((tier) => this.tierFields(tier, rankName));

    // FOUND ON REVIEW (self-check before this ever ran): withTenantContext
    // already wraps its own callback in one $transaction — its `tx` parameter's
    // own type deliberately OMITS $transaction (see PrismaAppService's own
    // signature), so nesting tx.$transaction(...) inside it isn't just
    // unnecessary, it's not even callable. All three writes below already
    // commit-or-rollback together as part of withTenantContext's own outer
    // transaction — no inner one needed.
    const rankId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rank = await tx.rank.create({
        data: {
          id: rankId,
          disciplineId,
          schoolId: discipline.schoolId,
          order: dto.order,
          name: rankName,
          primaryColour: dto.primaryColour,
          secondaryColour: dto.secondaryColour,
          tagColour: dto.tagColour,
          coralAccent: dto.coralAccent,
          weeklyClassCountCap: dto.weeklyClassCountCap,
          yearsInRankFlag: dto.yearsInRankFlag ?? false,
        },
      });
      for (const [i, tier] of dto.stripeTiers.entries()) {
        const tierId = randomUUID();
        await tx.rankStripeTier.create({
          data: { id: tierId, rankId, schoolId: discipline.schoolId, order: tier.order, ...tierData[i] },
        });
        if (tier.requiredSkillIds?.length) {
          await tx.rankStripeTierRequiredSkill.createMany({
            data: tier.requiredSkillIds.map((skillId) => ({ stripeTierId: tierId, skillId })),
          });
        }
      }
      if (dto.requiredSkillIds?.length) {
        await tx.rankRequiredSkill.createMany({
          data: dto.requiredSkillIds.map((skillId) => ({ rankId, skillId })),
        });
      }
      // FOUND ON REVIEW: `rank` here is only the bare row from the
      // `tx.rank.create()` call above — no `stripeTiers`/`requiredSkillIds`
      // (Prisma never includes a relation unless asked). Re-fetched with the
      // same include shapeRankResponse() expects, so the response actually
      // matches what RankResponseDto promises, not just the base columns.
      const full = await tx.rank.findUniqueOrThrow({
        where: { id: rankId },
        include: RANK_INCLUDE,
      });
      return this.shapeRankResponse(full);
    });
  }

  async findAllRanks(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const ranks = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findMany({
        where: { disciplineId: discipline.id },
        orderBy: { order: 'asc' },
        include: RANK_INCLUDE,
      }),
    );
    return ranks.map((r) => this.shapeRankResponse(r));
  }

  async findOneRank(callerId: string, rankId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findUnique({
        where: { id: rankId },
        include: RANK_INCLUDE,
      }),
    );
    if (!found) {
      throw new NotFoundException('Rank not found');
    }
    return this.shapeRankResponse(found);
  }

  async updateRank(callerId: string, rankId: string, dto: UpdateRankDto) {
    const existing = await this.findOneRank(callerId, rankId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);

    // UpdateRankDto's PartialType re-adds @IsOptional(), which lets `null`
    // past validation; refused here so it is a 400, not a 500 (found on
    // independent review, PR 2).
    if (dto.name === null || dto.requiredSkillIds === null || dto.stripeTiers === null) {
      throw new BadRequestException('name, requiredSkillIds and stripeTiers cannot be null; omit them to leave them unchanged.');
    }

    if (dto.order !== undefined) {
      const siblingOrders = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.rank.findMany({ where: { disciplineId: existing.disciplineId, id: { not: rankId } }, select: { order: true } }),
      );
      this.assertContiguousOrder(siblingOrders.map((r) => r.order), dto.order);
    }
    if (dto.stripeTiers) {
      this.assertContiguousStripeTiers(dto.stripeTiers.map((t) => t.order));
    }
    if (dto.requiredSkillIds?.length) {
      await this.assertSkillsBelongToDiscipline(callerId, dto.requiredSkillIds, existing.disciplineId);
    }
    const rankName = dto.name ?? existing.name;
    if (dto.stripeTiers) {
      await this.assertTierSkillsBelongToDiscipline(callerId, dto.stripeTiers, existing.disciplineId);
    }

    // See createRank's own comment on why this is one flat withTenantContext
    // call (already one transaction), not a nested tx.$transaction — the same
    // fix applies here.
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await lockLadder(tx, existing.disciplineId);
      const rank = await tx.rank.update({
        where: { id: rankId },
        data: {
          order: dto.order,
          name: dto.name,
          primaryColour: dto.primaryColour,
          secondaryColour: dto.secondaryColour,
          tagColour: dto.tagColour,
          coralAccent: dto.coralAccent,
          weeklyClassCountCap: dto.weeklyClassCountCap,
          yearsInRankFlag: dto.yearsInRankFlag,
        },
      });
      if (dto.stripeTiers) {
        // REPLACE semantics — see UpdateRankDto's own comment. FOUND ON REVIEW:
        // the original version of this block did a blanket deleteMany +
        // createMany with brand-new UUIDs on every call, which silently
        // orphaned StudentRank.currentStripeId (ON DELETE SET NULL) for EVERY
        // actively-graded Student at this Rank on ANY stripeTiers-touching
        // PATCH — not a rare edge case, since a tier's own `order` position
        // routinely stays the same across an edit that only changes e.g.
        // colour or classesRequired. Fixed to upsert by (rankId, order):
        // a position whose order is unchanged keeps its existing stable id
        // (only its other fields update in place), so any Student currently
        // pointing at that tier keeps pointing at a valid row. Only positions
        // genuinely removed from the new set are deleted (still ON DELETE SET
        // NULL for those — an unavoidable consequence of actually removing a
        // tier a Student is currently graded at), and only genuinely new
        // positions get a freshly generated id.
        const existingTiers = await tx.rankStripeTier.findMany({
          where: { rankId },
          select: { id: true, order: true, name: true, count: true, colour: true, stripeSegments: true, timeOnly: true, classCountMode: true, classTypeRequirements: true, bookingUnlocksClassTypes: true },
        });
        // Which existing rung each sent rung is (Decision 180). With ids:
        // by id, so a rung keeps its students while it moves. Without ids
        // (older clients): by position, as before.
        const byId = dto.stripeTiers.some((t) => t.id !== undefined);
        const existingById = new Map(existingTiers.map((t) => [t.id, t]));
        const existingByOrder = new Map(existingTiers.map((t) => [t.order, t]));
        if (byId) {
          const sentIds = dto.stripeTiers.filter((t) => t.id !== undefined).map((t) => t.id as string);
          if (new Set(sentIds).size !== sentIds.length) {
            throw new BadRequestException('Each stripe id can appear only once.');
          }
          if (sentIds.some((id) => !existingById.has(id))) {
            throw new BadRequestException('A stripe id is not one of this belt\'s stripes. Stripes can only be reordered within their own belt (Decision 180).');
          }
        }
        const previousFor = (tier: (typeof dto.stripeTiers)[number]) =>
          byId ? (tier.id !== undefined ? existingById.get(tier.id) : undefined) : existingByOrder.get(tier.order);
        const kept = new Set(dto.stripeTiers.map(previousFor).filter((t): t is (typeof existingTiers)[number] => !!t).map((t) => t.id));
        const idsToDelete = existingTiers.filter((t) => !kept.has(t.id)).map((t) => t.id);

        // A rung students hold can't be removed (Decision 152): they would be
        // left with no rung.
        if (idsToDelete.length) {
          const holders = await tx.studentRank.findMany({
            where: { currentStripeId: { in: idsToDelete } },
            select: { currentStripeId: true, student: { select: { firstName: true, surname: true } } },
          });
          if (holders.length) {
            const names = holders.map((h) => `${h.student.firstName} ${h.student.surname}`.trim());
            const rungs = [...new Set(holders.map((h) => existingById.get(h.currentStripeId as string)?.name ?? 'a stripe'))];
            throw new ConflictException(
              `Students hold ${rungs.join(', ')}, so it can't be removed: ${names.join(', ')}. Move them to another rank first (Decision 152).`,
            );
          }
          await tx.rankStripeTier.deleteMany({ where: { id: { in: idsToDelete } } });
        }
        // Positions are unique per belt: park the kept rungs first, so moving
        // one into another's place doesn't collide.
        for (const [i, id] of [...kept].entries()) {
          await tx.rankStripeTier.update({ where: { id }, data: { order: -1 - i } });
        }

        for (const tier of dto.stripeTiers) {
          const previous = previousFor(tier);
          // FOUND ON INDEPENDENT REVIEW (PR 2): the school portal's edit form
          // sends stripeTiers without the per-rung fields, which used to reset
          // a custom name, mixed stripe colours and timeOnly on every save.
          // Omitted per-rung fields are now kept (see tierFields).
          const fields = this.tierFields(tier, rankName, previous && { ...previous, rankName: existing.name });
          const existingId = previous?.id;
          let tierId: string;
          if (existingId) {
            tierId = existingId;
            await tx.rankStripeTier.update({ where: { id: existingId }, data: { ...fields, order: tier.order } });
          } else {
            tierId = randomUUID();
            await tx.rankStripeTier.create({
              data: { id: tierId, rankId, schoolId: existing.schoolId, order: tier.order, ...fields },
            });
          }
          // Per-rung required Skills: replaced when sent, left alone when
          // omitted (same convention as the belt-level requiredSkillIds below).
          if (tier.requiredSkillIds !== undefined) {
            await tx.rankStripeTierRequiredSkill.deleteMany({ where: { stripeTierId: tierId } });
            if (tier.requiredSkillIds.length) {
              await tx.rankStripeTierRequiredSkill.createMany({
                data: tier.requiredSkillIds.map((skillId) => ({ stripeTierId: tierId, skillId })),
              });
            }
          }
        }
      } else if (dto.name !== undefined && dto.name !== existing.name) {
        // Belt renamed without sending rungs: rung names that were generated
        // from the old belt name follow the new one; custom names are kept.
        const tiers = await tx.rankStripeTier.findMany({ where: { rankId }, select: { id: true, name: true, count: true } });
        for (const t of tiers) {
          if (t.name === RanksService.generatedTierName(existing.name, t.count)) {
            await tx.rankStripeTier.update({ where: { id: t.id }, data: { name: RanksService.generatedTierName(dto.name, t.count) } });
          }
        }
      }
      if (dto.requiredSkillIds !== undefined) {
        await tx.rankRequiredSkill.deleteMany({ where: { rankId } });
        if (dto.requiredSkillIds.length) {
          await tx.rankRequiredSkill.createMany({
            data: dto.requiredSkillIds.map((skillId) => ({ rankId, skillId })),
          });
        }
      }
      // FOUND ON REVIEW: same gap as createRank() — `rank` is only the bare
      // row from the `tx.rank.update()` call above, taken before the
      // stripeTiers/requiredSkillIds writes even ran. Re-fetched with the
      // full include so the response reflects what was actually persisted.
      const full = await tx.rank.findUniqueOrThrow({
        where: { id: rankId },
        include: RANK_INCLUDE,
      });
      return this.shapeRankResponse(full);
    });
  }

  /** Reorder a style's belts (Decisions 152, 180). Students keep their rung;
   * only the ladder order changes, so their next rank may change. The portal
   * shows who is affected before saving (findRungHolders). */
  async reorderRanks(callerId: string, disciplineId: string, dto: ReorderRanksDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await lockLadder(tx, disciplineId);
      const ranks = await tx.rank.findMany({ where: { disciplineId }, select: { id: true } });
      const ids = new Set(ranks.map((r) => r.id));
      if (dto.rankIds.length !== ids.size || dto.rankIds.some((id) => !ids.has(id))) {
        throw new BadRequestException('Send every belt of this style exactly once, in the new order.');
      }
      // Positions are unique per style: park every belt first.
      for (const [i, id] of dto.rankIds.entries()) {
        await tx.rank.update({ where: { id }, data: { order: -1 - i } });
      }
      for (const [i, id] of dto.rankIds.entries()) {
        await tx.rank.update({ where: { id }, data: { order: i } });
      }
      const full = await tx.rank.findMany({ where: { disciplineId }, include: RANK_INCLUDE, orderBy: { order: 'asc' } });
      return full.map((r) => this.shapeRankResponse(r));
    });
  }

  /** Deleting a belt (Decision 198): only when nobody holds it or any of its
   * stripes now, it isn't in anyone's grading history, and no instructor has
   * declared it. The belts after it move up one place. Owner only. */
  async deleteRank(callerId: string, rankId: string): Promise<void> {
    const rank = await this.prismaApp.withTenantContext(callerId, (tx) => tx.rank.findUnique({ where: { id: rankId }, include: { stripeTiers: { select: { id: true } } } }));
    if (!rank) throw new NotFoundException('Rank not found');
    await this.tenantAuth.assertSchoolOwner(callerId, rank.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, rank.schoolId);
    await this.assertRanksEnabled(callerId, rank.schoolId);
    const tierIds = rank.stripeTiers.map((t) => t.id);
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await lockLadder(tx, rank.disciplineId);
      const holders = await tx.studentRank.count({ where: { OR: [{ currentRankId: rankId }, { currentStripeId: { in: tierIds } }] } });
      if (holders > 0) throw new ConflictException(`${holders} student${holders === 1 ? ' holds' : 's hold'} this belt, so it can't be deleted.`);
      const history = await tx.promotionEvent.count({
        where: { OR: [{ fromRankId: rankId }, { toRankId: rankId }, { fromStripeTierId: { in: tierIds } }, { toStripeTierId: { in: tierIds } }] },
      });
      if (history > 0) throw new ConflictException('This belt is in students\' grading history, so it can\'t be deleted.');
      const declared = await tx.instructorBelt.count({ where: { OR: [{ rankId }, { stripeTierId: { in: tierIds } }] } });
      if (declared > 0) throw new ConflictException('An instructor has declared this belt, so it can\'t be deleted.');

      await tx.rankRequiredSkill.deleteMany({ where: { rankId } });
      await tx.rankStripeTier.deleteMany({ where: { rankId } });
      await tx.rank.delete({ where: { id: rankId } });
      // Close the gap: positions stay 0..N-1 (park first, they're unique per style).
      const rest = await tx.rank.findMany({ where: { disciplineId: rank.disciplineId }, orderBy: { order: 'asc' }, select: { id: true } });
      for (const [i, r] of rest.entries()) await tx.rank.update({ where: { id: r.id }, data: { order: -1 - i } });
      for (const [i, r] of rest.entries()) await tx.rank.update({ where: { id: r.id }, data: { order: i } });
    });
  }

  /** Who holds each rung of a style, for the ladder editor's confirmations
   * (Decision 152): before a reorder, and to explain why a rung can't be
   * removed. Owner only, like every ladder edit. */
  async findRungHolders(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentRank.findMany({
        where: { disciplineId, currentStripeId: { not: null } },
        select: { currentStripeId: true, student: { select: { id: true, firstName: true, surname: true } } },
        orderBy: [{ student: { firstName: 'asc' } }, { student: { surname: 'asc' } }],
      }),
    );
    const byRung = new Map<string, Array<{ studentId: string; firstName: string; surname: string }>>();
    for (const r of rows) {
      const list = byRung.get(r.currentStripeId as string) ?? [];
      list.push({ studentId: r.student.id, firstName: r.student.firstName, surname: r.student.surname });
      byRung.set(r.currentStripeId as string, list);
    }
    return { items: [...byRung.entries()].map(([rungId, students]) => ({ rungId, students })) };
  }

  // ---------------------------------------------------------------------------
  // Skill CRUD — School Owner/Manager only.
  // ---------------------------------------------------------------------------

  async createSkill(callerId: string, disciplineId: string, dto: CreateSkillDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.create({
        data: { id, disciplineId, schoolId: discipline.schoolId, name: dto.name, description: dto.description },
      }),
    );
  }

  async findAllSkills(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.findMany({ where: { disciplineId: discipline.id }, orderBy: { name: 'asc' } }),
    );
  }

  async updateSkill(callerId: string, skillId: string, dto: UpdateSkillDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!existing) {
      throw new NotFoundException('Skill not found');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.update({ where: { id: skillId }, data: { name: dto.name, description: dto.description } }),
    );
  }

  /** Deleting a skill (Decision 198): only when no student has ever had it
   * marked (Learning or Signed off, now or in the sign-off log). It comes off
   * the stripes that required it and the lessons that list it, unless it is a
   * lesson's only skill. Owner only. */
  async deleteSkill(callerId: string, skillId: string): Promise<void> {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!existing) throw new NotFoundException('Skill not found');
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await lockLadder(tx, existing.disciplineId);
      const marked = (await tx.studentRankSkillStatus.count({ where: { skillId } })) + (await tx.skillSignOffLog.count({ where: { skillId } }));
      if (marked > 0) throw new ConflictException('Students have been marked on this skill, so it can\'t be deleted.');
      const links = await tx.lessonSkill.findMany({ where: { skillId }, select: { lessonId: true } });
      for (const { lessonId } of links) {
        if ((await tx.lessonSkill.count({ where: { lessonId } })) === 1) {
          throw new ConflictException('A lesson has this as its only skill. Give that lesson another skill, or delete it, first.');
        }
      }
      await tx.lessonSkill.deleteMany({ where: { skillId } });
      await tx.rankRequiredSkill.deleteMany({ where: { skillId } });
      await tx.rankStripeTierRequiredSkill.deleteMany({ where: { skillId } });
      await tx.skill.delete({ where: { id: skillId } });
    });
  }

  // ---------------------------------------------------------------------------
  // Shared response shaping
  // ---------------------------------------------------------------------------

  /**
   * FOUND ON REVIEW (Phase 21 — school-portal's own Rank management screen was
   * the first real client ever to call these four endpoints and read their
   * actual response bodies): RankResponseDto promises `requiredSkillIds:
   * string[]`, but findAllRanks()/findOneRank() returned the raw Prisma
   * `include: { requiredSkills: true }` relation directly — `requiredSkills:
   * {rankId, skillId}[]`, not a flat array of ids at all. Every consumer
   * reading `.requiredSkillIds` off a real API response would hit
   * `Cannot read properties of undefined` (there is no ClassSerializerInterceptor
   * anywhere in this codebase to auto-transform the DTO's declared shape into
   * reality — verified directly, not assumed). createRank()/updateRank() had
   * the same gap in the other direction: both returned the bare `Rank` row
   * from their own `tx.rank.create()`/`tx.rank.update()` call, with no
   * `stripeTiers`/`requiredSkillIds` populated AT ALL (Prisma doesn't include
   * relations unless asked). All four methods now route through this one
   * shaping function, which both `include`s the right relations and maps
   * `requiredSkills` to the promised flat `requiredSkillIds` — a single place
   * the response contract is actually honored, rather than four independent,
   * inconsistent partial ones.
   */
  private shapeRankResponse(
    rank: Prisma.RankGetPayload<{ include: typeof RANK_INCLUDE }>,
  ) {
    const { requiredSkills, stripeTiers, ...rest } = rank;
    return {
      ...rest,
      requiredSkillIds: requiredSkills.map((s) => s.skillId),
      stripeTiers: stripeTiers.map(({ requiredSkills: tierSkills, ...tier }) => ({
        ...tier,
        requiredSkillIds: tierSkills.map((s) => s.skillId),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Shared validation helpers
  // ---------------------------------------------------------------------------

  /**
   * FOUND ON REVIEW (kickoff prompt §1.g, resolved as a product decision
   * 2026-09-09): School.ranksToggle is a real backend gate on WRITES, not a UI
   * hint. Every method above that creates/modifies Discipline/Rank/Skill data
   * calls this first — reads are deliberately unaffected (see the kickoff
   * prompt's own reasoning: existing grading history shouldn't become
   * inaccessible just because a School toggles ranks off today).
   *
   * Public so GradingService can apply the same gate to promote/downgrade/
   * stripe-award/skill sign-off: Decision 87 names those writes explicitly,
   * but until now only the catalog writes above called this.
   */
  async assertRanksEnabled(callerId: string, schoolId: string): Promise<void> {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { ranksToggle: true } }),
    );
    if (!school.ranksToggle) {
      throw new ForbiddenException('This School has ranks disabled (School.ranksToggle) — enable it before creating or modifying rank data.');
    }
  }

  /** "Blue Belt · 2 Stripes"; a rung with no stripes is just the belt name. */
  private static generatedTierName(rankName: string, count: number): string {
    return count === 0 ? rankName : `${rankName} · ${count} Stripe${count === 1 ? '' : 's'}`;
  }

  /** Builds one rung's stored fields from its input (grading foundation PR 2,
   * Decisions 126/128). Segments that are sent must add up to `count`, so the
   * drawn belt and the stripe count can never disagree.
   *
   * A new rung (no `previous`): a missing name is generated from the belt name
   * and stripe count, missing segments become one segment of `count` x
   * `colour`, and timeOnly defaults to false.
   *
   * An existing rung being updated (`previous`): an omitted field keeps its
   * stored value — the name unless it was the generated one (then it is
   * regenerated, so it follows a new belt name or count), the segments while
   * `count` and `colour` are unchanged, and timeOnly.
   *
   * Decision 165: the stripe list is the only place a rung's stripe colours
   * are set, and the single `colour` is filled in from its FIRST segment (the
   * newest colour, the one the rung is named after), so the two can never
   * disagree. A rung with no stripes keeps the `colour` sent. Changing
   * `colour` alone on a rung with MIXED stripes is refused (400): there is no
   * single colour to repaint them with — the stripe list must be sent. */
  private tierFields(
    tier: RankStripeTierInputDto,
    rankName: string,
    previous?: {
      name: string;
      count: number;
      colour: string;
      stripeSegments: Prisma.JsonValue;
      timeOnly: boolean;
      classCountMode: 'ANY_TYPE' | 'EACH_TYPE';
      classTypeRequirements: Prisma.JsonValue;
      bookingUnlocksClassTypes: string[];
      rankName: string;
    },
  ) {
    const defaultSegments = tier.count > 0 ? [{ count: tier.count, colour: tier.colour }] : [];
    const keepSegments = previous && previous.count === tier.count && previous.colour === tier.colour;
    const previousSegments = (previous?.stripeSegments ?? []) as unknown as { count: number; colour: string }[];
    if (!tier.stripeSegments && previous && previous.count === tier.count && previous.colour !== tier.colour && previousSegments.length > 1) {
      throw new BadRequestException(
        `Stripe tier ${tier.order} has mixed stripe colours; change them in its stripeSegments, not its single colour (Decision 165).`,
      );
    }
    const segments = tier.stripeSegments ?? (keepSegments ? previousSegments : defaultSegments);
    const segmentTotal = segments.reduce((sum, s) => sum + s.count, 0);
    if (segmentTotal !== tier.count) {
      throw new BadRequestException(
        `stripeSegments for stripe tier ${tier.order} add up to ${segmentTotal} stripes, but count is ${tier.count}.`,
      );
    }
    // Which classes count (Decisions 140, 149). Omitted on an existing rung:
    // kept, like the other per-rung fields.
    const eligibleClassTypes = tier.eligibleClassTypes ?? [];
    const classCountMode = tier.classCountMode ?? previous?.classCountMode ?? 'ANY_TYPE';
    const classTypeRequirements =
      tier.classTypeRequirements ??
      ((previous?.classTypeRequirements ?? []) as unknown as { classType: string; classesRequired: number }[]);
    if (classCountMode === 'ANY_TYPE') {
      if (classTypeRequirements.length) {
        throw new BadRequestException(`Stripe tier ${tier.order}: classTypeRequirements are only used with classCountMode EACH_TYPE.`);
      }
    } else {
      const required = classTypeRequirements.map((r) => r.classType);
      const sameSet =
        eligibleClassTypes.length > 0 &&
        new Set(required).size === required.length &&
        required.length === eligibleClassTypes.length &&
        required.every((t) => eligibleClassTypes.includes(t));
      if (!sameSet) {
        throw new BadRequestException(
          `Stripe tier ${tier.order}: with classCountMode EACH_TYPE, give one number in classTypeRequirements for each ticked class type in eligibleClassTypes (Decision 149).`,
        );
      }
    }
    const generatedName = RanksService.generatedTierName(rankName, tier.count);
    const keepName = previous && previous.name !== RanksService.generatedTierName(previous.rankName, previous.count);
    return {
      count: tier.count,
      colour: segments.length ? segments[0].colour : tier.colour,
      classesRequired: tier.classesRequired,
      minimumDaysInRank: tier.minimumDaysInRank,
      eligibleClassTypes,
      classCountMode,
      classTypeRequirements: classTypeRequirements.map((r) => ({ classType: r.classType, classesRequired: r.classesRequired })),
      name: tier.name ?? (keepName ? previous.name : generatedName),
      stripeSegments: segments.map((s) => ({ count: s.count, colour: s.colour })),
      weeklyClassCountCap: tier.weeklyClassCountCap,
      timeOnly: tier.timeOnly ?? previous?.timeOnly ?? false,
      bookingUnlocksClassTypes: [...new Set(tier.bookingUnlocksClassTypes ?? previous?.bookingUnlocksClassTypes ?? [])],
    };
  }

  private async assertTierSkillsBelongToDiscipline(callerId: string, tiers: RankStripeTierInputDto[], disciplineId: string): Promise<void> {
    const skillIds = [...new Set(tiers.flatMap((t) => t.requiredSkillIds ?? []))];
    if (skillIds.length) {
      await this.assertSkillsBelongToDiscipline(callerId, skillIds, disciplineId);
    }
  }

  /** School Portal validates Rank.order is unique and contiguous per Discipline
   * (§5) — enforced here at write time. `order` values are 0-based and must form
   * a contiguous run with no gaps once the new/updated value is inserted. */
  private assertContiguousOrder(existingOrders: number[], newOrder: number): void {
    const all = [...existingOrders, newOrder].sort((a, b) => a - b);
    for (let i = 0; i < all.length; i++) {
      if (all[i] !== i) {
        throw new BadRequestException(`order values must be contiguous starting at 0 — got [${all.join(', ')}]`);
      }
    }
  }

  private assertContiguousStripeTiers(orders: number[]): void {
    const sorted = [...orders].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i) {
        throw new BadRequestException(`stripeTiers order values must be contiguous starting at 0 — got [${sorted.join(', ')}]`);
      }
    }
  }

  private async assertSkillsBelongToDiscipline(callerId: string, skillIds: string[], disciplineId: string): Promise<void> {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.findMany({ where: { id: { in: skillIds }, disciplineId }, select: { id: true } }),
    );
    if (found.length !== skillIds.length) {
      throw new BadRequestException('requiredSkillIds must all reference Skills belonging to this Rank\'s Discipline');
    }
  }
}
