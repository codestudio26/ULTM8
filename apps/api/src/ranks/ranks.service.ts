import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateRankDto } from './dto/update-rank.dto';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

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
    await this.assertRanksEnabled(callerId, schoolId);

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.create({
        data: { id, schoolId, name: dto.name, classTypesOffered: dto.classTypesOffered ?? [] },
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
    await this.assertRanksEnabled(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.update({ where: { id: disciplineId }, data: { name: dto.name, classTypesOffered: dto.classTypesOffered } }),
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
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertContiguousStripeTiers(dto.stripeTiers.map((t) => t.order));

    const existingOrders = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findMany({ where: { disciplineId }, select: { order: true }, orderBy: { order: 'asc' } }),
    );
    this.assertContiguousOrder(existingOrders.map((r) => r.order), dto.order);

    if (dto.requiredSkillIds?.length) {
      await this.assertSkillsBelongToDiscipline(callerId, dto.requiredSkillIds, disciplineId);
    }

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
          primaryColour: dto.primaryColour,
          secondaryColour: dto.secondaryColour,
          weeklyClassCountCap: dto.weeklyClassCountCap,
          yearsInRankFlag: dto.yearsInRankFlag ?? false,
        },
      });
      await tx.rankStripeTier.createMany({
        data: dto.stripeTiers.map((tier) => ({
          id: randomUUID(),
          rankId,
          schoolId: discipline.schoolId,
          order: tier.order,
          count: tier.count,
          colour: tier.colour,
          classesRequired: tier.classesRequired,
          minimumDaysInRank: tier.minimumDaysInRank,
          eligibleClassTypes: tier.eligibleClassTypes ?? [],
        })),
      });
      if (dto.requiredSkillIds?.length) {
        await tx.rankRequiredSkill.createMany({
          data: dto.requiredSkillIds.map((skillId) => ({ rankId, skillId })),
        });
      }
      return rank;
    });
  }

  async findAllRanks(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findMany({
        where: { disciplineId: discipline.id },
        orderBy: { order: 'asc' },
        include: { stripeTiers: { orderBy: { order: 'asc' } }, requiredSkills: true },
      }),
    );
  }

  async findOneRank(callerId: string, rankId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findUnique({
        where: { id: rankId },
        include: { stripeTiers: { orderBy: { order: 'asc' } }, requiredSkills: true },
      }),
    );
    if (!found) {
      throw new NotFoundException('Rank not found');
    }
    return found;
  }

  async updateRank(callerId: string, rankId: string, dto: UpdateRankDto) {
    const existing = await this.findOneRank(callerId, rankId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);

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

    // See createRank's own comment on why this is one flat withTenantContext
    // call (already one transaction), not a nested tx.$transaction — the same
    // fix applies here.
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rank = await tx.rank.update({
        where: { id: rankId },
        data: {
          order: dto.order,
          primaryColour: dto.primaryColour,
          secondaryColour: dto.secondaryColour,
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
        const existingTiers = await tx.rankStripeTier.findMany({ where: { rankId }, select: { id: true, order: true } });
        const existingIdByOrder = new Map(existingTiers.map((t) => [t.order, t.id]));
        const newOrders = new Set(dto.stripeTiers.map((t) => t.order));

        const idsToDelete = existingTiers.filter((t) => !newOrders.has(t.order)).map((t) => t.id);
        if (idsToDelete.length) {
          await tx.rankStripeTier.deleteMany({ where: { id: { in: idsToDelete } } });
        }

        for (const tier of dto.stripeTiers) {
          const existingId = existingIdByOrder.get(tier.order);
          if (existingId) {
            await tx.rankStripeTier.update({
              where: { id: existingId },
              data: {
                count: tier.count,
                colour: tier.colour,
                classesRequired: tier.classesRequired,
                minimumDaysInRank: tier.minimumDaysInRank,
                eligibleClassTypes: tier.eligibleClassTypes ?? [],
              },
            });
          } else {
            await tx.rankStripeTier.create({
              data: {
                id: randomUUID(),
                rankId,
                schoolId: existing.schoolId,
                order: tier.order,
                count: tier.count,
                colour: tier.colour,
                classesRequired: tier.classesRequired,
                minimumDaysInRank: tier.minimumDaysInRank,
                eligibleClassTypes: tier.eligibleClassTypes ?? [],
              },
            });
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
      return rank;
    });
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
    await this.assertRanksEnabled(callerId, existing.schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.update({ where: { id: skillId }, data: { name: dto.name, description: dto.description } }),
    );
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
   */
  private async assertRanksEnabled(callerId: string, schoolId: string): Promise<void> {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { ranksToggle: true } }),
    );
    if (!school.ranksToggle) {
      throw new ForbiddenException('This School has ranks disabled (School.ranksToggle) — enable it before creating or modifying rank data.');
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
