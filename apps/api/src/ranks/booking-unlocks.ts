import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { bookingAccess } from './engine';
import { loadLadder } from './grading-attendance';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * The booking rank gate (Decision 173, replacing Decision 90's activities
 * bridge): for each style the class lists, its class type must be open (no
 * rung of that style unlocks it) or unlocked by the student's rung or a rung
 * below. Set per rung by the school owner. An unverified self-declared rank
 * books by the rung declared (Decision 137). Staff can override per booking.
 */
export async function assertBookingUnlocked(
  tx: TenantTx,
  studentId: string,
  cls: { styles: Prisma.JsonValue },
  overrideHint = '',
): Promise<void> {
  const styles = cls.styles as unknown as Array<{ disciplineId: string; classType: string | null }>;
  for (const style of styles) {
    if (style.classType === null) continue;
    const ladder = await loadLadder(tx, style.disciplineId);
    const studentRank = await tx.studentRank.findUnique({
      where: { studentId_disciplineId: { studentId, disciplineId: style.disciplineId } },
      select: { currentStripeId: true },
    });
    if (bookingAccess(ladder, studentRank?.currentStripeId ?? null, style.classType) === 'LOCKED') {
      const discipline = await tx.discipline.findUnique({ where: { id: style.disciplineId }, select: { name: true } });
      throw new ForbiddenException(
        `This Student hasn't reached a rank that unlocks ${discipline?.name ?? 'this style'} · ${style.classType} classes.${overrideHint}`,
      );
    }
  }
}
