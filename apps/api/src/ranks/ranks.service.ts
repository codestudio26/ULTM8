import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { SaveBeltColoursDto } from './dto/belt-colours.dto';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { CreateRankDto, RankStripeTierInputDto } from './dto/create-rank.dto';
import { UpdateRankDto } from './dto/update-rank.dto';
import { ReorderRanksDto, ReorderSkillsDto } from './dto/ladder.dto';
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
} satisfies Prisma.RankInclude;

type Tx = Prisma.TransactionClient;

const NAME_MAX = 100;

/** Student ranks of people still enrolled at the School (an active STUDENT
 * grant): the style's student count leaves out students who have left
 * (Decision 310). */
function enrolledAt(schoolId: string) {
  return { student: { roleGrants: { some: { role: 'STUDENT' as const, schoolId, revokedAt: null } } } };
}

/** Names of the students holding ranks, and whether each is still enrolled
 * (Decision 310). Read separately from the ranks: row security hides the
 * account of someone with no active role at the School, so a student who left
 * has no name here, and joining it from the rank would fail. */
async function holderPeople(tx: Prisma.TransactionClient, schoolId: string, studentIds: string[]) {
  const users = await tx.user.findMany({
    where: { id: { in: [...new Set(studentIds)] } },
    select: { id: true, firstName: true, surname: true, roleGrants: { where: { role: 'STUDENT', schoolId, revokedAt: null }, select: { id: true }, take: 1 } },
  });
  return new Map(users.map((u) => [u.id, { firstName: u.firstName, surname: u.surname, enrolled: u.roleGrants.length > 0 }]));
}

/** Class types as stored (Decision 308): trimmed, blanks dropped, and a type
 * repeated with other capitals merged into its first spelling. */
export function cleanClassTypes(types: string[]): string[] {
  const out: string[] = [];
  for (const raw of types) {
    const t = raw.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Another style of the School with this name, any capitals (Decision 308). */
async function assertDisciplineNameFree(tx: Tx, schoolId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.discipline.findFirst({
    where: { schoolId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { archivedAt: true },
  });
  if (clash) {
    throw new ConflictException(`A discipline called "${name}" already exists${clash.archivedAt ? ' (archived — unarchive it instead)' : ''}.`);
  }
}

/** `base`, or `base (2)`, `base (3)`… — the first name no style of the School
 * has, cut to fit 100 characters (Decision 308). With `suffix` ("Copy"):
 * `base (Copy)`, `base (Copy 2)`… */
async function freeDisciplineName(tx: Tx, schoolId: string, base: string, suffix?: string): Promise<string> {
  const taken = new Set(
    (await tx.discipline.findMany({ where: { schoolId }, select: { name: true } })).map((d) => d.name.toLowerCase()),
  );
  for (let n = 1; ; n++) {
    const tag = suffix ? ` (${suffix}${n > 1 ? ` ${n}` : ''})` : n > 1 ? ` (${n})` : '';
    const name = `${base.slice(0, NAME_MAX - tag.length).trimEnd()}${tag}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Closes gaps in a style's belt positions so they run 0..N-1 again (parked
 * first: positions are unique per style). A gap is left when the purge job
 * removes an archived belt (Decision 308). Run under lockLadder. */
async function closeBeltGaps(tx: Tx, disciplineId: string): Promise<void> {
  const belts = await tx.rank.findMany({ where: { disciplineId }, orderBy: { order: 'asc' }, select: { id: true, order: true } });
  if (belts.every((b, i) => b.order === i)) return;
  for (const [i, b] of belts.entries()) await tx.rank.update({ where: { id: b.id }, data: { order: -1 - i } });
  for (const [i, b] of belts.entries()) await tx.rank.update({ where: { id: b.id }, data: { order: i } });
}

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
    const actor = await this.disciplineManager(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.assertRanksEnabled(callerId, schoolId);

    const id = randomUUID();
    return this.prismaApp.withTenantContext(actor, async (tx) => {
      await assertDisciplineNameFree(tx, schoolId, dto.name);
      const created = await tx.discipline.create({
        data: { id, schoolId, name: dto.name, classTypesOffered: cleanClassTypes(dto.classTypesOffered ?? []), skillsRequiredToGrade: dto.skillsRequiredToGrade ?? false },
      });
      return { ...created, studentCount: 0 };
    });
  }

  /** The ladder templates a style can start from (Decision 131). */
  listTemplates() {
    return { items: TEMPLATES.map((t) => ({ ...t, rungs: buildIbjjfTemplate(t.id).reduce((sum, b) => sum + b.rungs.length, 0) })) };
  }

  /** A new style from an IBJJF template (Decisions 131, 182): the prototype's
   * belts, rungs, numbers and class types, as the school's own copy to edit
   * freely. The owner, or Branch Staff who manage disciplines (Decision 383). */
  async createFromTemplate(callerId: string, schoolId: string, dto: CreateStyleFromTemplateDto) {
    await this.schoolsService.findOne(callerId, schoolId);
    const actor = await this.disciplineManager(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.assertRanksEnabled(callerId, schoolId);
    const template = TEMPLATES.find((t) => t.id === dto.templateId)!;
    const belts = buildIbjjfTemplate(dto.templateId);

    return this.prismaApp.withTenantContext(actor, async (tx) => {
      // A name the owner typed must be free; the default one is numbered
      // instead ("IBJJF Adult (2)") so a second copy just works (Decision 308).
      if (dto.name) await assertDisciplineNameFree(tx, schoolId, dto.name);
      const name = dto.name ?? (await freeDisciplineName(tx, schoolId, template.name));
      const discipline = await tx.discipline.create({
        data: { id: randomUUID(), schoolId, name, classTypesOffered: [...IBJJF_CLASS_TYPES] },
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
      return { ...discipline, studentCount: 0 };
    });
  }

  /** Duplicate a style (Decision 182, prototype duplicateStyle): its belts and
   * rungs with all their rules, its skills (re-linked to the copied rungs),
   * class types, "skills required" switch and board %. Not its students, their
   * ranks, lesson links or coach permissions. Named "… (Copy)", or "… (Copy 2)"
   * and so on when that name is taken, cut to fit 100 characters; archived
   * belts are left out (Decision 308). The owner, or Branch Staff who manage disciplines. */
  async duplicateDiscipline(callerId: string, disciplineId: string) {
    const source = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, source.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, source.schoolId);
    await this.assertRanksEnabled(callerId, source.schoolId);

    return this.prismaApp.withTenantContext(actor, async (tx) => {
      const copy = await tx.discipline.create({
        data: {
          id: randomUUID(),
          schoolId: source.schoolId,
          name: await freeDisciplineName(tx, source.schoolId, source.name, 'Copy'),
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
        await tx.skill.create({ data: { id, disciplineId: copy.id, schoolId: source.schoolId, name: skill.name, description: skill.description, order: skill.order } });
      }
      const ranks = await tx.rank.findMany({ where: { disciplineId, archivedAt: null }, include: RANK_INCLUDE, orderBy: { order: 'asc' } });
      for (const [order, rank] of ranks.entries()) {
        const { id: _id, disciplineId: _d, createdAt: _c, updatedAt: _u, archivedAt: _a, purgeAt: _p, purgedAt: _pd, stripeTiers, ...rankFields } = rank;
        const rankId = randomUUID();
        await tx.rank.create({ data: { ...rankFields, order, id: rankId, disciplineId: copy.id } });
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
      return { ...copy, studentCount: 0 };
    });
  }

  /** Archived styles are left out unless asked for (Decision 309), so every
   * picker that lists this School's styles hides them. */
  async findAllDisciplines(callerId: string, schoolId: string, includeArchived = false) {
    await this.schoolsService.findOne(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.findMany({
        where: { schoolId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { name: 'asc' },
        include: { _count: { select: { studentRanks: { where: enrolledAt(schoolId) } } } },
      }),
    );
    return rows.map(({ _count, ...d }) => ({ ...d, studentCount: _count.studentRanks }));
  }

  /** Backlog 3.18: the School's saved belt colours, for the belt editor. Anyone
   * who can open the School can read them; only colour codes are stored. */
  async findBeltColours(callerId: string, schoolId: string): Promise<{ colours: string[] }> {
    await this.schoolsService.findOne(callerId, schoolId);
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { savedBeltColours: true } }),
    );
    return { colours: school.savedBeltColours };
  }

  /** Backlog 3.18: replace the whole list. The same people who edit the
   * ladder (the owner, or Branch Staff who manage disciplines, Decision 383).
   * Codes are stored in capitals and repeats dropped; belts and stripes keep
   * their own colour values, so removing a saved colour changes none of them. */
  async saveBeltColours(callerId: string, schoolId: string, dto: SaveBeltColoursDto): Promise<{ colours: string[] }> {
    await this.schoolsService.findOne(callerId, schoolId);
    const actor = await this.disciplineManager(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const colours = [...new Set(dto.colours.map((c) => c.toUpperCase()))];
    const school = await this.prismaApp.withTenantContext(actor, (tx) =>
      tx.school.update({ where: { id: schoolId }, data: { savedBeltColours: colours }, select: { savedBeltColours: true } }),
    );
    return { colours: school.savedBeltColours };
  }

  /** One style with its student count, for the API response. */
  async getDiscipline(callerId: string, disciplineId: string) {
    const found = await this.findOneDiscipline(callerId, disciplineId);
    return {
      ...found,
      studentCount: await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.studentRank.count({ where: { disciplineId, ...enrolledAt(found.schoolId) } }),
      ),
    };
  }

  /** An archived style is read-only until unarchived (Decision 309). */
  private assertDisciplineActive(discipline: { name: string; archivedAt: Date | null }): void {
    if (discipline.archivedAt) {
      throw new ConflictException(`"${discipline.name}" is archived. Unarchive it on the Disciplines page to change it.`);
    }
  }

  async findOneDiscipline(callerId: string, disciplineId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!found) {
      throw new NotFoundException('Discipline not found');
    }
    return found;
  }

  /** Edit a style (Decisions 308, 309). A new name is carried onto the
   * classes, timetable slots and instructors that show it. Class types can be
   * renamed (`renameClassTypes`), which carries the new name onto classes,
   * slots and rungs; a type that live classes, slots or rungs still use can't
   * simply be removed. */
  async updateDiscipline(callerId: string, disciplineId: string, dto: UpdateDisciplineDto) {
    const existing = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    this.assertDisciplineActive(existing);
    // PartialType re-adds @IsOptional(), which lets `null` past validation:
    // refused here as a 400, not a 500 (Decision 308).
    if (dto.name === null || dto.classTypesOffered === null || dto.skillsRequiredToGrade === null) {
      throw new BadRequestException('name, classTypesOffered and skillsRequiredToGrade cannot be null; omit them to leave them unchanged.');
    }
    if (dto.renameClassTypes?.length && dto.classTypesOffered === undefined) {
      throw new BadRequestException('Send classTypesOffered (the list after the renames) with renameClassTypes.');
    }

    return this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, disciplineId);
      const current = await tx.discipline.findUniqueOrThrow({ where: { id: disciplineId } });
      const renamed = dto.name !== undefined && dto.name !== current.name;
      if (renamed && dto.name!.toLowerCase() !== current.name.toLowerCase()) {
        await assertDisciplineNameFree(tx, current.schoolId, dto.name!, disciplineId);
      }

      let classTypes: string[] | undefined;
      if (dto.classTypesOffered !== undefined) {
        classTypes = cleanClassTypes(dto.classTypesOffered);
        await this.applyClassTypeChanges(tx, current, classTypes, dto.renameClassTypes ?? []);
      }
      if (renamed) {
        await this.carryDisciplineName(tx, current, dto.name!);
      }

      const updated = await tx.discipline.update({
        where: { id: disciplineId },
        data: { name: dto.name, classTypesOffered: classTypes, skillsRequiredToGrade: dto.skillsRequiredToGrade },
      });
      return { ...updated, studentCount: await tx.studentRank.count({ where: { disciplineId, ...enrolledAt(updated.schoolId) } }) };
    });
  }

  /** Class type edits (Decision 309). Renames carry over; a removed type must
   * not be in use by an upcoming or ongoing class, a live timetable slot or a
   * rung. Past and archived classes keep their old label. */
  private async applyClassTypeChanges(
    tx: Tx,
    discipline: { id: string; schoolId: string; classTypesOffered: string[] },
    next: string[],
    renames: Array<{ from: string; to: string }>,
  ): Promise<void> {
    const old = discipline.classTypesOffered;
    const froms = new Set<string>();
    for (const r of renames) {
      if (!old.includes(r.from)) throw new BadRequestException(`"${r.from}" is not one of this style's class types, so it can't be renamed.`);
      if (froms.has(r.from)) throw new BadRequestException(`"${r.from}" is renamed twice.`);
      if (!next.includes(r.to)) throw new BadRequestException(`The new name "${r.to}" must be in classTypesOffered.`);
      if (old.some((o) => o !== r.from && o.toLowerCase() === r.to.toLowerCase())) {
        throw new BadRequestException(`"${r.to}" is already a class type of this style. Rename to a new name.`);
      }
      froms.add(r.from);
    }
    const removed = old.filter((t) => !next.includes(t) && !froms.has(t));
    if (removed.length) {
      // The first type still in use, in one fixed sentence the portal can
      // translate (Decision 310); the next one shows once this is fixed.
      const use = await this.classTypeInUse(tx, discipline, removed);
      if (use) {
        throw new ConflictException(
          `"${use.type}" is still in use (upcoming classes: ${use.classes}, timetable slots: ${use.slots}, rungs on the ladder: ${use.rungs}). Rename the class type instead of removing it, or change those first.`,
        );
      }
    }
    const changes = renames.filter((r) => r.from !== r.to);
    if (!changes.length) return;

    const tiers = await tx.rankStripeTier.findMany({
      where: { rank: { disciplineId: discipline.id } },
      select: { id: true, eligibleClassTypes: true, bookingUnlocksClassTypes: true, classTypeRequirements: true },
    });
    const map = new Map(changes.map((r) => [r.from, r.to]));
    const swap = (t: string) => map.get(t) ?? t;
    for (const tier of tiers) {
      const reqs = (tier.classTypeRequirements ?? []) as unknown as Array<{ classType: string; classesRequired: number }>;
      const touched =
        tier.eligibleClassTypes.some((t) => map.has(t)) || tier.bookingUnlocksClassTypes.some((t) => map.has(t)) || reqs.some((r) => map.has(r.classType));
      if (!touched) continue;
      await tx.rankStripeTier.update({
        where: { id: tier.id },
        data: {
          eligibleClassTypes: tier.eligibleClassTypes.map(swap),
          bookingUnlocksClassTypes: tier.bookingUnlocksClassTypes.map(swap),
          classTypeRequirements: reqs.map((r) => ({ ...r, classType: swap(r.classType) })) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    // Every class and slot of the style, past and archived too: a rename is a
    // relabel, so history shows the one name.
    for (const r of changes) {
      const match = JSON.stringify([{ disciplineId: discipline.id, classType: r.from }]);
      for (const table of ['Class', 'TimetableSlot'] as const) {
        await tx.$executeRawUnsafe(
          `UPDATE "${table}" SET "styles" = (
             SELECT jsonb_agg(CASE WHEN e->>'disciplineId' = $1 AND e->>'classType' = $2 THEN jsonb_set(e, '{classType}', to_jsonb($3::text)) ELSE e END ORDER BY i)
             FROM jsonb_array_elements("styles") WITH ORDINALITY AS x(e, i))
           WHERE "schoolId" = $4 AND "styles" @> $5::jsonb`,
          discipline.id,
          r.from,
          r.to,
          discipline.schoolId,
          match,
        );
      }
    }
  }

  /** The first of these class types that something still uses, with the counts. */
  private async classTypeInUse(
    tx: Tx,
    discipline: { id: string; schoolId: string },
    types: string[],
  ): Promise<{ type: string; classes: number; slots: number; rungs: number } | null> {
    const tiers = await tx.rankStripeTier.findMany({
      where: { rank: { disciplineId: discipline.id } },
      select: { eligibleClassTypes: true, bookingUnlocksClassTypes: true, classTypeRequirements: true },
    });
    for (const type of types) {
      const match = JSON.stringify([{ disciplineId: discipline.id, classType: type }]);
      const [{ n: classes }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Class" WHERE "schoolId" = ${discipline.schoolId} AND "archivedAt" IS NULL AND "endDate" >= now() AND "styles" @> ${match}::jsonb`;
      const [{ n: slots }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "TimetableSlot" WHERE "schoolId" = ${discipline.schoolId} AND "archivedAt" IS NULL AND "styles" @> ${match}::jsonb`;
      const rungs = tiers.filter(
        (t) =>
          t.eligibleClassTypes.includes(type) ||
          t.bookingUnlocksClassTypes.includes(type) ||
          ((t.classTypeRequirements ?? []) as unknown as Array<{ classType: string }>).some((r) => r.classType === type),
      ).length;
      if (classes + slots + rungs > 0) return { type, classes, slots, rungs };
    }
    return null;
  }

  /** A renamed style's name carried onto the copies other records keep for
   * display (Decision 308): classes' and slots' `activities` (Decision 90's
   * bridge, filled from style names) and instructors' `specializations`. */
  private async carryDisciplineName(tx: Tx, discipline: { id: string; schoolId: string; name: string }, name: string): Promise<void> {
    const match = JSON.stringify([{ disciplineId: discipline.id }]);
    for (const table of ['Class', 'TimetableSlot'] as const) {
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "activities" = array_replace("activities", $1, $2) WHERE "schoolId" = $3 AND "styles" @> $4::jsonb AND $1 = ANY("activities")`,
        discipline.name,
        name,
        discipline.schoolId,
        match,
      );
    }
    await tx.$executeRaw`UPDATE "Instructor" SET "specializations" = array_replace("specializations", ${discipline.name}, ${name}) WHERE "schoolId" = ${discipline.schoolId} AND ${discipline.id} = ANY("specializationStyleIds")`;
  }

  /** Archive (retire) a style no live class or timetable slot uses (Decision
   * 309). It drops out of every picker and can't be graded or edited; its
   * students keep their rank and history. Never purged. The owner, or Branch Staff who manage disciplines. */
  async archiveDiscipline(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    if (discipline.archivedAt) return this.getDiscipline(callerId, disciplineId);
    await this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, disciplineId);
      const match = JSON.stringify([{ disciplineId }]);
      const [{ n: classes }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "Class" WHERE "schoolId" = ${discipline.schoolId} AND "archivedAt" IS NULL AND "endDate" >= now() AND "styles" @> ${match}::jsonb`;
      const [{ n: slots }] = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "TimetableSlot" WHERE "schoolId" = ${discipline.schoolId} AND "archivedAt" IS NULL AND "styles" @> ${match}::jsonb`;
      if (classes + slots > 0) {
        throw new ConflictException(`This style is still in use (upcoming classes: ${classes}, timetable slots: ${slots}). Archive or change them first.`);
      }
      await tx.discipline.updateMany({ where: { id: disciplineId, archivedAt: null }, data: { archivedAt: new Date() } });
    });
    return this.getDiscipline(callerId, disciplineId);
  }

  async unarchiveDiscipline(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    if (discipline.archivedAt) {
      await this.prismaApp.withTenantContext(actor, async (tx) => {
        await assertDisciplineNameFree(tx, discipline.schoolId, discipline.name, disciplineId);
        await tx.discipline.update({ where: { id: disciplineId }, data: { archivedAt: null } });
      });
    }
    return this.getDiscipline(callerId, disciplineId);
  }

  /** Deleting (Decision 198): only what has never been used. A style goes only
   * when nobody has ever held a rank in it, no instructor has declared a belt
   * in it, and no class, timetable slot or lesson uses it; its belts, skills
   * and coach permissions go with it, and it is taken off membership plans and
   * instructors' styles. The owner, or Branch Staff who manage disciplines. */
  async deleteDiscipline(callerId: string, disciplineId: string): Promise<void> {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    await this.prismaApp.withTenantContext(actor, async (tx) => {
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
      await tx.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: { in: skillIds } } });
      await tx.skill.deleteMany({ where: { disciplineId } });
      const belts = await tx.rank.findMany({ where: { disciplineId }, select: { id: true } });
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
  // Rank CRUD (with nested stripe tiers) — the owner, or Branch Staff who manage disciplines (Decision 383).
  // ---------------------------------------------------------------------------

  async createRank(callerId: string, disciplineId: string, dto: CreateRankDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertDisciplineActive(discipline);
    this.assertContiguousStripeTiers(dto.stripeTiers.map((t) => t.order));
    if (dto.stripeTiers.some((t) => t.id !== undefined)) {
      throw new BadRequestException('A new belt has only new stripes; stripe ids are for updating a belt.');
    }
    const showPrices = await this.assertPricesAllowed(callerId, actor, discipline.schoolId, disciplineId, dto.stripeTiers);

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
    return this.prismaApp.withTenantContext(actor, async (tx) => {
      // Positions are checked after closing any gap the purge job left
      // (Decision 308), so "add at the end" works again.
      await lockLadder(tx, disciplineId);
      await closeBeltGaps(tx, disciplineId);
      const existingOrders = await tx.rank.findMany({ where: { disciplineId }, select: { order: true }, orderBy: { order: 'asc' } });
      this.assertContiguousOrder(existingOrders.map((r) => r.order), dto.order);
      await tx.rank.create({
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
      // FOUND ON REVIEW: `rank` here is only the bare row from the
      // `tx.rank.create()` call above — no `stripeTiers`/`requiredSkillIds`
      // (Prisma never includes a relation unless asked). Re-fetched with the
      // same include shapeRankResponse() expects, so the response actually
      // matches what RankResponseDto promises, not just the base columns.
      const full = await tx.rank.findUniqueOrThrow({
        where: { id: rankId },
        include: RANK_INCLUDE,
      });
      return this.shapeRankResponse(full, showPrices);
    });
  }

  /** Decision 226 — `includeArchived` (default false) excludes archived
   * belts from the ladder's default view, same "excluded by default,
   * visible via a filter" convention applied to every one of the 7
   * entities this build covers. */
  async findAllRanks(callerId: string, disciplineId: string, includeArchived?: boolean) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const ranks = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findMany({
        where: { disciplineId: discipline.id, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { order: 'asc' },
        include: RANK_INCLUDE,
      }),
    );
    const showPrices = await this.pricesVisible(callerId, discipline.schoolId, discipline.id);
    return ranks.map((r) => this.shapeRankResponse(r, showPrices));
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
    return this.shapeRankResponse(found, await this.promotionFeeOn(callerId, found.schoolId));
  }

  async updateRank(callerId: string, rankId: string, dto: UpdateRankDto) {
    const existing = await this.findOneRank(callerId, rankId);
    const actor = await this.disciplineManager(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, existing.disciplineId));

    // UpdateRankDto's PartialType re-adds @IsOptional(), which lets `null`
    // past validation; refused here so it is a 400, not a 500 (found on
    // independent review, PR 2).
    if (dto.name === null || dto.stripeTiers === null) {
      throw new BadRequestException('name and stripeTiers cannot be null; omit them to leave them unchanged.');
    }

    if (dto.order !== undefined) {
      const siblingOrders = await this.prismaApp.withTenantContext(actor, (tx) =>
        tx.rank.findMany({ where: { disciplineId: existing.disciplineId, id: { not: rankId } }, select: { order: true } }),
      );
      this.assertContiguousOrder(siblingOrders.map((r) => r.order), dto.order);
    }
    if (dto.stripeTiers) {
      this.assertContiguousStripeTiers(dto.stripeTiers.map((t) => t.order));
    }
    const rankName = dto.name ?? existing.name;
    if (dto.stripeTiers) {
      await this.assertTierSkillsBelongToDiscipline(callerId, dto.stripeTiers, existing.disciplineId);
    }
    const showPrices = await this.assertPricesAllowed(callerId, actor, existing.schoolId, existing.disciplineId, dto.stripeTiers ?? []);

    // See createRank's own comment on why this is one flat withTenantContext
    // call (already one transaction), not a nested tx.$transaction — the same
    // fix applies here.
    return this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, existing.disciplineId);
      await tx.rank.update({
        where: { id: rankId },
        data: {
          order: dto.order,
          name: dto.name,
          primaryColour: dto.primaryColour,
          secondaryColour: dto.secondaryColour,
          tagColour: dto.tagColour,
          coralAccent: dto.coralAccent,
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
            // Decision 180
            throw new BadRequestException('A stripe id is not one of this belt\'s stripes. Stripes can only be reordered within their own belt.');
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
            select: { currentStripeId: true, studentId: true },
          });
          if (holders.length) {
            const people = await holderPeople(tx, existing.schoolId, holders.map((h) => h.studentId));
            const names = holders.map((h) => {
              const p = people.get(h.studentId);
              return p ? `${p.firstName} ${p.surname}`.trim() : 'a former student';
            });
            const rungs = [...new Set(holders.map((h) => existingById.get(h.currentStripeId as string)?.name ?? 'a stripe'))];
            throw new ConflictException(
              // Decision 152
              `Students hold ${rungs.join(', ')}, so it can't be removed: ${names.join(', ')}. Move them to another rank first.`,
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
          // omitted.
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
      // FOUND ON REVIEW: same gap as createRank() — `rank` is only the bare
      // row from the `tx.rank.update()` call above, taken before the
      // stripeTiers/requiredSkillIds writes even ran. Re-fetched with the
      // full include so the response reflects what was actually persisted.
      const full = await tx.rank.findUniqueOrThrow({
        where: { id: rankId },
        include: RANK_INCLUDE,
      });
      return this.shapeRankResponse(full, showPrices);
    });
  }

  /** Reorder a style's belts (Decisions 152, 180). Students keep their rung;
   * only the ladder order changes, so their next rank may change. The portal
   * shows who is affected before saving (findRungHolders). */
  async reorderRanks(callerId: string, disciplineId: string, dto: ReorderRanksDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertDisciplineActive(discipline);

    const showPrices = await this.pricesVisible(callerId, discipline.schoolId, disciplineId);
    return this.prismaApp.withTenantContext(actor, async (tx) => {
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
      return full.map((r) => this.shapeRankResponse(r, showPrices));
    });
  }

  /** Shared by deleteRank() (Decision 198) and archive() (Decision 226) —
   * both need the identical "is this belt safe to remove" answer: nobody
   * holds it or any of its stripes, it isn't in anyone's grading history,
   * and no instructor has declared it. Extracted here (Decision 226) rather
   * than duplicated a second time, so the two actions can never silently
   * drift into two different definitions of "safe" for the same entity.
   * Throws ConflictException with the specific reason if not safe; the
   * caller must already hold `tx` inside a transaction that also locked the
   * ladder (lockLadder) if it's about to mutate anything off the result. */
  private async assertRankSafeToRemove(
    tx: Pick<Prisma.TransactionClient, 'studentRank' | 'promotionEvent' | 'instructorBelt'>,
    rankId: string,
    tierIds: string[],
    action: 'deleted' | 'archived',
  ): Promise<void> {
    const holders = await tx.studentRank.count({ where: { OR: [{ currentRankId: rankId }, { currentStripeId: { in: tierIds } }] } });
    if (holders > 0) throw new ConflictException(`${holders} student${holders === 1 ? ' holds' : 's hold'} this belt, so it can't be ${action}.`);
    const history = await tx.promotionEvent.count({
      where: { OR: [{ fromRankId: rankId }, { toRankId: rankId }, { fromStripeTierId: { in: tierIds } }, { toStripeTierId: { in: tierIds } }] },
    });
    if (history > 0) throw new ConflictException(`This belt is in students' grading history, so it can't be ${action}.`);
    const declared = await tx.instructorBelt.count({ where: { OR: [{ rankId }, { stripeTierId: { in: tierIds } }] } });
    if (declared > 0) throw new ConflictException(`An instructor has declared this belt, so it can't be ${action}.`);
  }

  /** Deleting a belt (Decision 198): only when nobody holds it or any of its
   * stripes now, it isn't in anyone's grading history, and no instructor has
   * declared it. The belts after it move up one place. The owner, or Branch Staff who manage disciplines. */
  async deleteRank(callerId: string, rankId: string): Promise<void> {
    const rank = await this.prismaApp.withTenantContext(callerId, (tx) => tx.rank.findUnique({ where: { id: rankId }, include: { stripeTiers: { select: { id: true } } } }));
    if (!rank) throw new NotFoundException('Rank not found');
    const actor = await this.disciplineManager(callerId, rank.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, rank.schoolId);
    await this.assertRanksEnabled(callerId, rank.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, rank.disciplineId));
    const tierIds = rank.stripeTiers.map((t) => t.id);
    await this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, rank.disciplineId);
      await this.assertRankSafeToRemove(tx, rankId, tierIds, 'deleted');

      await tx.rankStripeTier.deleteMany({ where: { rankId } });
      await tx.rank.delete({ where: { id: rankId } });
      // Close the gap: positions stay 0..N-1 (park first, they're unique per style).
      const rest = await tx.rank.findMany({ where: { disciplineId: rank.disciplineId }, orderBy: { order: 'asc' }, select: { id: true } });
      for (const [i, r] of rest.entries()) await tx.rank.update({ where: { id: r.id }, data: { order: -1 - i } });
      for (const [i, r] of rest.entries()) await tx.rank.update({ where: { id: r.id }, data: { order: i } });
    });
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding, REVERSIBLE alternative to
  // Decision 198's deleteRank() above (coexists with it; see Rank's own
  // schema.prisma comment for why this build adds archive rather than
  // replacing the already-shipped hard-delete). Same School-Owner gate,
  // same ranksToggle gate, and the identical "safe to remove" definition
  // deleteRank() already established (assertRankSafeToRemove) — a Rank
  // blocked from deletion is equally blocked from archiving, by design.
  // ---------------------------------------------------------------------------

  async archiveRank(callerId: string, rankId: string) {
    const rank = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.rank.findUnique({ where: { id: rankId }, include: { stripeTiers: { select: { id: true } } } }),
    );
    if (!rank) throw new NotFoundException('Rank not found');
    const actor = await this.disciplineManager(callerId, rank.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, rank.schoolId);
    await this.assertRanksEnabled(callerId, rank.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, rank.disciplineId));
    if (rank.archivedAt) {
      return this.findOneRank(callerId, rankId); // idempotent.
    }
    const tierIds = rank.stripeTiers.map((t) => t.id);
    const now = new Date();
    const purgeAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    await this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, rank.disciplineId);
      await this.assertRankSafeToRemove(tx, rankId, tierIds, 'archived');
      // TOCTOU-safe conditional update, same pattern every other entity in
      // this build uses — re-checked against the row's CURRENT state at
      // write time, not the possibly-stale `rank` read above.
      await tx.rank.updateMany({ where: { id: rankId, archivedAt: null }, data: { archivedAt: now, purgeAt } });
    });
    return this.findOneRank(callerId, rankId);
  }

  async unarchiveRank(callerId: string, rankId: string) {
    const rank = await this.prismaApp.withTenantContext(callerId, (tx) => tx.rank.findUnique({ where: { id: rankId } }));
    if (!rank) throw new NotFoundException('Rank not found');
    const actor = await this.disciplineManager(callerId, rank.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, rank.schoolId);
    await this.assertRanksEnabled(callerId, rank.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, rank.disciplineId));
    if (!rank.archivedAt) {
      return this.findOneRank(callerId, rankId); // idempotent.
    }
    if (rank.purgedAt) {
      throw new ConflictException('This Rank has already been purged and cannot be unarchived.');
    }
    const { count } = await this.prismaApp.withTenantContext(actor, (tx) =>
      tx.rank.updateMany({
        where: { id: rankId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      }),
    );
    if (count === 0) {
      const current = await this.prismaApp.withTenantContext(actor, (tx) => tx.rank.findUniqueOrThrow({ where: { id: rankId } }));
      if (current.purgedAt) {
        throw new ConflictException('This Rank has already been purged and cannot be unarchived.');
      }
    }
    return this.findOneRank(callerId, rankId);
  }

  /** Who holds each rung of a style, for the ladder editor's confirmations
   * (Decision 152): before a reorder, and to explain why a rung can't be
   * removed. Owner only, like every ladder edit. */
  async findRungHolders(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    await this.tenantAuth.assertSchoolOwner(callerId, discipline.schoolId);
    const { rows, people } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const rows = await tx.studentRank.findMany({
        where: { disciplineId, currentStripeId: { not: null } },
        select: { currentStripeId: true, studentId: true },
      });
      return { rows, people: await holderPeople(tx, discipline.schoolId, rows.map((r) => r.studentId)) };
    });
    // Enrolled students by name; students who left (no name to show) last.
    const holders = rows
      .map((r) => {
        const p = people.get(r.studentId);
        return { rungId: r.currentStripeId as string, studentId: r.studentId, firstName: p?.firstName ?? '', surname: p?.surname ?? '', enrolled: p?.enrolled ?? false };
      })
      .sort((a, b) => Number(b.enrolled) - Number(a.enrolled) || a.firstName.localeCompare(b.firstName) || a.surname.localeCompare(b.surname));
    const byRung = new Map<string, Array<{ studentId: string; firstName: string; surname: string; enrolled: boolean }>>();
    for (const { rungId, ...h } of holders) {
      const list = byRung.get(rungId) ?? [];
      list.push(h);
      byRung.set(rungId, list);
    }
    return { items: [...byRung.entries()].map(([rungId, students]) => ({ rungId, students })) };
  }

  // ---------------------------------------------------------------------------
  // Skill CRUD — the owner, or Branch Staff who manage disciplines (Decision 383).
  // ---------------------------------------------------------------------------

  /** A new skill goes at the end of the style's list; no two skills of a
   * style share a name, any capitals (Decision 308). */
  async createSkill(callerId: string, disciplineId: string, dto: CreateSkillDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertDisciplineActive(discipline);

    const id = randomUUID();
    return this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, disciplineId);
      await this.assertSkillNameFree(tx, disciplineId, dto.name);
      const last = await tx.skill.findFirst({ where: { disciplineId }, orderBy: { order: 'desc' }, select: { order: true } });
      const skill = await tx.skill.create({
        data: { id, disciplineId, schoolId: discipline.schoolId, name: dto.name, description: dto.description, order: (last?.order ?? -1) + 1 },
      });
      return { ...skill, lessonCount: 0 };
    });
  }

  /** In the owner's order (Decision 309), each with how many lessons teach it. */
  async findAllSkills(callerId: string, disciplineId: string) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.skill.findMany({
        where: { disciplineId: discipline.id },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { lessons: true } } },
      }),
    );
    return rows.map(({ _count, ...skill }) => ({ ...skill, lessonCount: _count.lessons }));
  }

  /** Put a style's skills in order (Decision 309): every skill, once. */
  async reorderSkills(callerId: string, disciplineId: string, dto: ReorderSkillsDto) {
    const discipline = await this.findOneDiscipline(callerId, disciplineId);
    const actor = await this.disciplineManager(callerId, discipline.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, discipline.schoolId);
    await this.assertRanksEnabled(callerId, discipline.schoolId);
    this.assertDisciplineActive(discipline);
    await this.prismaApp.withTenantContext(actor, async (tx) => {
      await lockLadder(tx, disciplineId);
      const ids = new Set((await tx.skill.findMany({ where: { disciplineId }, select: { id: true } })).map((sk) => sk.id));
      if (dto.skillIds.length !== ids.size || dto.skillIds.some((id) => !ids.has(id))) {
        throw new BadRequestException('Send every skill of this style exactly once, in the new order.');
      }
      for (const [i, id] of dto.skillIds.entries()) await tx.skill.update({ where: { id }, data: { order: i } });
    });
    return this.findAllSkills(callerId, disciplineId);
  }

  private async assertSkillNameFree(tx: Tx, disciplineId: string, name: string, exceptId?: string): Promise<void> {
    const clash = await tx.skill.findFirst({
      where: { disciplineId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`This style already has a skill called "${name}".`);
  }

  async updateSkill(callerId: string, skillId: string, dto: UpdateSkillDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!existing) {
      throw new NotFoundException('Skill not found');
    }
    const actor = await this.disciplineManager(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, existing.disciplineId));
    if (dto.name === null) {
      throw new BadRequestException('name cannot be null; omit it to leave it unchanged.');
    }
    return this.prismaApp.withTenantContext(actor, async (tx) => {
      if (dto.name !== undefined && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
        await lockLadder(tx, existing.disciplineId);
        await this.assertSkillNameFree(tx, existing.disciplineId, dto.name, skillId);
      }
      const skill = await tx.skill.update({ where: { id: skillId }, data: { name: dto.name, description: dto.description } });
      return { ...skill, lessonCount: await tx.lessonSkill.count({ where: { skillId } }) };
    });
  }

  /** Deleting a skill (Decision 198): only when no student has ever had it
   * marked (Learning or Signed off, now or in the sign-off log). It comes off
   * the stripes that required it and the lessons that list it, unless it is a
   * lesson's only skill. The owner, or Branch Staff who manage disciplines. */
  async deleteSkill(callerId: string, skillId: string): Promise<void> {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!existing) throw new NotFoundException('Skill not found');
    const actor = await this.disciplineManager(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    await this.assertRanksEnabled(callerId, existing.schoolId);
    this.assertDisciplineActive(await this.findOneDiscipline(callerId, existing.disciplineId));
    await this.prismaApp.withTenantContext(actor, async (tx) => {
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
    // Promotion fee prices (Decision 307): returned only while the School's
    // promotion fee is on; with it off they are left out of every response.
    showPrices: boolean,
  ) {
    const { stripeTiers, ...rest } = rank;
    return {
      ...rest,
      stripeTiers: stripeTiers.map(({ requiredSkills: tierSkills, promotionFeeMinor, ...tier }) => ({
        ...tier,
        ...(showPrices ? { promotionFeeMinor } : {}),
        requiredSkillIds: tierSkills.map((s) => s.skillId),
      })),
    };
  }

  /** Whether the School's promotion fee is on (Decisions 287, 307). */
  /** Who sees prices on the ladder (Decision 314 item 1): while the fee is on,
   * the School owner and anyone with grading permission for this style. Other
   * staff, students and guardians get the ladder without prices. */
  private async pricesVisible(callerId: string, schoolId: string, disciplineId: string): Promise<boolean> {
    if (!(await this.promotionFeeOn(callerId, schoolId))) return false;
    try {
      await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
      return true;
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }
    const permission = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.gradingPermission.findUnique({ where: { userId_disciplineId: { userId: callerId, disciplineId } }, select: { schoolId: true } }),
    );
    return permission?.schoolId === schoolId;
  }

  private async promotionFeeOn(callerId: string, schoolId: string): Promise<boolean> {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { promotionFeeEnabled: true } }),
    );
    return school?.promotionFeeEnabled ?? false;
  }

  /** Prices per grade (Decisions 300, 307) are set by the owner (the rank
   * endpoints are owner-only already) and only while the promotion fee is on:
   * with it off the belt editor has no price field, so a price sent then is
   * refused with a 400 rather than stored out of sight. Branch Staff who
   * manage disciplines (Decision 383) leave prices as they are: a price they
   * send is refused, and the ones already set are kept. Returns whether
   * prices are shown in the response. */
  private async assertPricesAllowed(callerId: string, actor: string, schoolId: string, disciplineId: string, tiers: RankStripeTierInputDto[]): Promise<boolean> {
    const on = await this.promotionFeeOn(callerId, schoolId);
    const priced = tiers.some((t) => t.promotionFeeMinor !== undefined);
    if (!on && priced) {
      throw new BadRequestException('The promotion fee is off for this School, so grades have no price. The owner can turn it on in Grading settings.');
    }
    if (actor === callerId) return on;
    if (priced) throw new ForbiddenException('Only the School owner sets the price of a grade.');
    return this.pricesVisible(callerId, schoolId, disciplineId);
  }

  // ---------------------------------------------------------------------------
  // Shared validation helpers
  // ---------------------------------------------------------------------------

  /**
   * Decision 383 — who may change this School's styles, belts and skills, and
   * whose view of the School the change runs with: the owner, as themselves;
   * Branch Staff the owner switched "Can manage disciplines" on for, as the
   * School's main owner. Styles are School-wide, while a Branch Staff
   * member's own row security shows only their branch's classes and none of
   * the students' ranks, so in their own view the "still in use" checks would
   * miss the rest of the School and a rename would reach only their branch.
   * Every method that uses the returned id has called this first, and it is
   * used only for the Disciplines writes. The students list on a style stays
   * owner-only (findRungHolders). The ranks tables keep no record of who made
   * a change, so nothing is written in the owner's name.
   */
  private async disciplineManager(callerId: string, schoolId: string): Promise<string> {
    const [row] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.$queryRaw<Array<{ actor: string | null }>>`SELECT "discipline_manager_context"(${schoolId}) AS actor`,
    );
    if (!row?.actor) {
      // Spec §8.2
      throw new ForbiddenException('Only that School\'s Owner/Manager may perform this action.');
    }
    return row.actor;
  }

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
        // Decision 165
        `Stripe tier ${tier.order} has mixed stripe colours; change them in its stripeSegments, not its single colour.`,
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
          // Decision 149
          `Stripe tier ${tier.order}: with classCountMode EACH_TYPE, give one number in classTypeRequirements for each ticked class type in eligibleClassTypes.`,
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
      // Promotion fee (Decision 300): null clears it (free); omitted keeps it
      // on an existing rung and leaves a new one free.
      ...(tier.promotionFeeMinor !== undefined ? { promotionFeeMinor: tier.promotionFeeMinor } : {}),
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
