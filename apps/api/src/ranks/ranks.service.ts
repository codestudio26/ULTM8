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
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

/** The one include every Rank read uses, so shapeRankResponse() always gets
 * stripe tiers (in ladder order) with their per-rung required Skills. */
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

  // No delete method — same reasoning ClassesModule/School/Branch/MembershipPlan/
  // Waiver already established (general tenant offboarding is [UNRESOLVED]).

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
      throw new BadRequestException('A new belt has only new rungs; rung ids are for updating a belt.');
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
            throw new BadRequestException('Each rung id can appear only once.');
          }
          if (sentIds.some((id) => !existingById.has(id))) {
            throw new BadRequestException('A rung id is not a rung of this belt. Rungs can only be reordered within their own belt (Decision 180).');
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
            const rungs = [...new Set(holders.map((h) => existingById.get(h.currentStripeId as string)?.name ?? 'a rung'))];
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

  // No delete method — same reasoning as Discipline above, doubly so here:
  // deleting a Rank Students currently hold is blocked at the DB level anyway
  // (StudentRank.currentRankId is ON DELETE RESTRICT — see the migration's own
  // comment).

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
