import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClassStyleInputDto } from './dto/class-style.dto';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface ResolvedClassStyles {
  styles: Array<{ disciplineId: string; classType: string | null }>;
  activities: string[];
}

/**
 * Shared by Class and TimetableSlot create/update (grading foundation PR 5,
 * Decisions 143, 152, 170). Run inside the caller's tenant context.
 *
 * - A School with styles: at least one style, each a style of this School,
 *   no style twice; a class type from that style's list when the style lists
 *   any, none when it lists none. A mixed class (e.g. an Open Mat for BJJ and
 *   Judo) lists several styles.
 * - A School with no styles: no styles; free-text `activities` as before.
 *
 * - An archived style (Decision 309) can't be newly picked; one the record
 *   already lists (`keepDisciplineIds`) may stay, so an old class can still
 *   be edited.
 *
 * `activities` stays what Decision 90's bridge (booking rank gate, attendance
 * credit) reads until the grading engine switches to `styles`. When the caller
 * sends styles without activities, activities is filled in from the styles'
 * names, which is what that bridge matches on.
 */
export async function resolveClassStyles(
  tx: Tx,
  schoolId: string,
  styles: ClassStyleInputDto[] | undefined,
  activities: string[] | undefined,
  keepDisciplineIds: string[] = [],
): Promise<ResolvedClassStyles> {
  // The styles picked are share-locked until the class or slot is saved, so
  // archiving one (RanksService.archiveDiscipline, which locks it and counts
  // the classes and slots using it) waits for this save and then counts it,
  // or finishes first and is seen below. Before, a style could be archived
  // while a class using it was being created (stress test, 27 Oct 2026).
  // In id order, so two saves never lock in opposite orders.
  const pickedIds = [...new Set((styles ?? []).map((s) => s.disciplineId))].sort();
  if (pickedIds.length > 0) {
    await tx.$queryRaw`SELECT id FROM "Discipline" WHERE "schoolId" = ${schoolId} AND id = ANY(${pickedIds}::text[]) ORDER BY id FOR SHARE`;
  }
  const disciplines = await tx.discipline.findMany({ where: { schoolId }, select: { id: true, name: true, classTypesOffered: true, archivedAt: true } });

  if (disciplines.length === 0) {
    if (styles?.length) {
      throw new BadRequestException('This School has no styles yet, so a class cannot be given one.');
    }
    if (!activities?.length) {
      throw new BadRequestException('activities must contain at least one entry.');
    }
    return { styles: [], activities };
  }

  if (!styles?.length) {
    throw new BadRequestException('This School has styles: choose at least one style for this class (styles).');
  }
  const byId = new Map(disciplines.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const resolved = styles.map((s) => {
    const discipline = byId.get(s.disciplineId);
    if (!discipline) {
      throw new BadRequestException('Every style must be a style of this School.');
    }
    if (seen.has(s.disciplineId)) {
      throw new BadRequestException(`The style "${discipline.name}" is listed twice.`);
    }
    seen.add(s.disciplineId);
    if (discipline.archivedAt && !keepDisciplineIds.includes(s.disciplineId)) {
      throw new BadRequestException(`"${discipline.name}" is archived, so it can't be given to a class. Unarchive it on the Disciplines page first.`);
    }
    const classType = s.classType ?? null;
    if (discipline.classTypesOffered.length > 0) {
      if (!classType || !discipline.classTypesOffered.includes(classType)) {
        throw new BadRequestException(
          `Choose a class type for "${discipline.name}" from its list: ${discipline.classTypesOffered.join(', ')}.`,
        );
      }
    } else if (classType) {
      throw new BadRequestException(`"${discipline.name}" has no class types, so none can be chosen.`);
    }
    return { disciplineId: s.disciplineId, classType };
  });

  return {
    styles: resolved,
    activities: activities?.length ? activities : resolved.map((s) => byId.get(s.disciplineId)!.name),
  };
}

/** The style ids a stored `styles` value lists (for `keepDisciplineIds`). */
export function styleIdsOf(styles: unknown): string[] {
  return Array.isArray(styles) ? styles.map((s) => (s as { disciplineId?: unknown }).disciplineId).filter((id): id is string => typeof id === 'string') : [];
}
