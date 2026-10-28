import { PrismaClient } from '@prisma/client';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Whether a Student holds a Signed waiver that counts at this School: the
 * check behind a class's or a plan's "requires a waiver". A signature on an
 * archived waiver counts unless the School turned that off (Decision 354,
 * Waiver settings). An Expired signature never counts. Runs in the caller's
 * transaction, usually the Student's own tenant context. */
export async function hasCountingWaiverSignature(tx: TenantTx, studentId: string, schoolId: string): Promise<boolean> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { waiverArchivedSignaturesCount: true } });
  const signed = await tx.waiverSignature.findFirst({
    where: {
      studentId,
      schoolId,
      status: 'SIGNED',
      ...(school && !school.waiverArchivedSignaturesCount ? { waiver: { archivedAt: null } } : {}),
    },
    select: { id: true },
  });
  return !!signed;
}
