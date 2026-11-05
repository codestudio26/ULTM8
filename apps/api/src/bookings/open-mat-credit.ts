import { PrismaClient } from '@prisma/client';
import { isOpenMat } from '../ranks/hours-trained';

type Tx = Pick<PrismaClient, 'class' | 'school'>;
type ClassStyle = { disciplineId: string; classType: string | null };

/** Whether every style on the class is open mat (Decision 304 item 1: the
 * class type "Open mat"). A class with no styles, or a mixed one with any
 * other class type, is not. */
export function isOpenMatClass(styles: unknown): boolean {
  const list = (Array.isArray(styles) ? styles : []) as ClassStyle[];
  return list.length > 0 && list.every((s) => isOpenMat(s?.classType));
}

/**
 * Whether booking a seat in this class takes a credit (Decision 304 item 3,
 * "Open mat uses a class credit", on by default). Only an open mat at a
 * School that turned the setting off takes none. Read in the booking's own
 * transaction; a row it can't read counts as "takes a credit", as before.
 */
export async function bookingUsesCredit(tx: Tx, classId: string, schoolId: string): Promise<boolean> {
  const cls = await tx.class.findUnique({ where: { id: classId }, select: { styles: true } });
  if (!isOpenMatClass(cls?.styles)) return true;
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { openMatUsesClassCredit: true } });
  return school?.openMatUsesClassCredit ?? true;
}
