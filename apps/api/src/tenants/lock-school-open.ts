import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Decision 110: a closed School takes no new records. The check before a write
 * (TenantAuthorizationService.assertSchoolNotArchived) can't see a close that
 * commits between it and the write: the stress test of 28 Oct 2026 saw a desk
 * sale create its Membership 43 ms after the close had answered.
 *
 * Called inside the write's own transaction, before it writes. FOR SHARE waits
 * for a close still in flight and then reads it; a close that comes later waits
 * for this transaction to commit, so its billing stop sees what was written.
 * Writes share the lock with each other, so they never queue behind one another.
 * The caller's tenant context must see the School (any live grant there does).
 */
export async function lockSchoolOpen(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, schoolId: string): Promise<void> {
  const [school] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`SELECT "archivedAt" FROM "School" WHERE id = ${schoolId} FOR SHARE`;
  if (school?.archivedAt) {
    throw new ForbiddenException('This School has been closed and no longer accepts new or updated records.');
  }
}
