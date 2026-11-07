import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { RolesChangedService } from '../common/prisma/roles-changed.service';

/**
 * "Delete my account" rule 2: signing in again within the 30 days cancels the
 * deletion — the member's own, and that of each child their request included.
 * Called by AuthService.login() once the passcode matched, before any token is
 * issued. Each row is written as its own person (the self policy), as the
 * request was. Returns whether anything was cancelled. Subscriptions already
 * cancelled at Stripe stay cancelled (the member buys their plan again).
 */
export async function cancelDeletionOnSignIn(
  db: { prismaApp: PrismaAppService; prismaAuth: PrismaAuthService; prismaJobs: PrismaJobsService; rolesChanged: RolesChangedService },
  userId: string,
): Promise<boolean> {
  const children = await db.prismaAuth.user.findMany({
    where: { deletionRequestedById: userId, id: { not: userId }, deletionRequestedAt: { not: null }, erasedAt: null },
    select: { id: true },
  });
  const cleared = await db.prismaApp.withMultiTenantContext(async (tx, setContext) => {
    const done: string[] = [];
    for (const id of [userId, ...children.map((c) => c.id)]) {
      await setContext(id);
      const { count } = await tx.user.updateMany({
        where: { id, deletionRequestedAt: { not: null }, erasedAt: null, ...(id === userId ? {} : { deletionRequestedById: userId }) },
        data: { deletionRequestedAt: null, deletionDueAt: null, deletionRequestedById: null },
      });
      if (count > 0) done.push(id);
    }
    return done;
  });
  for (const id of cleared) db.rolesChanged.forget(id);
  if (cleared.length === 0) return false;
  await db.prismaJobs.accountErasureLog.createMany({
    data: cleared.map((id) => ({ id: randomUUID(), userId: id, event: 'CANCELLED' as const, requestedById: userId })),
  });
  return cleared.includes(userId);
}
