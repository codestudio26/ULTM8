import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Instructor specialisations (Decision 152, item 1). Run inside the caller's
 * tenant context.
 *
 * - A School with styles: specialisations are picked from its styles
 *   (`specializationStyleIds`, no style twice); free text is refused, and
 *   `specializations` is filled in from the chosen styles' names so the
 *   Instructors page keeps showing them. Still optional: an empty list is fine.
 * - A School with no styles: free-text `specializations` as before; style ids
 *   are refused.
 *
 * Returns undefined when neither field was sent (nothing to change).
 */
export async function resolveInstructorSpecializations(
  tx: Tx,
  schoolId: string,
  styleIds: string[] | undefined,
  specializations: string[] | undefined,
): Promise<{ specializationStyleIds: string[]; specializations: string[] } | undefined> {
  if (styleIds === undefined && specializations === undefined) return undefined;

  const disciplines = await tx.discipline.findMany({ where: { schoolId }, select: { id: true, name: true } });
  if (disciplines.length === 0) {
    if (styleIds?.length) {
      throw new BadRequestException('This School has no styles yet, so specialisations are free text (specializations).');
    }
    return { specializationStyleIds: [], specializations: specializations ?? [] };
  }

  if (specializations?.length) {
    throw new BadRequestException('This School has styles: pick specialisations from them (specializationStyleIds), not free text.');
  }
  const ids = styleIds ?? [];
  const byId = new Map(disciplines.map((d) => [d.id, d.name]));
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('A style is listed twice in specializationStyleIds.');
  }
  if (ids.some((id) => !byId.has(id))) {
    throw new BadRequestException('Every specialisation must be a style of this School.');
  }
  return { specializationStyleIds: ids, specializations: ids.map((id) => byId.get(id)!) };
}
