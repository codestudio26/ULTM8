import { PrismaAuthService } from './prisma-auth.service';

export interface ResolvedUserName {
  firstName: string;
  surname: string;
}

/**
 * Resolves display names for a set of User ids via PrismaAuthService (see its own
 * header comment) rather than an ordinary RLS-scoped Prisma `include` — deliberately
 * immune to user_self_or_shared_school's shared-active-RoleGrant requirement, which
 * can make a target's own User row invisible under normal tenant context (e.g.
 * GuardiansService.withdrawConsent's BASELINE cascade revokes every RoleGrant a
 * Student holds, at every School, synchronously). A caller using this has already
 * established — via its own RLS-scoped query for the row referencing this id — that
 * it's authorized to know about that id; this only resolves the minimum display
 * fields for it, the same constraint every other PrismaAuthService call site follows.
 */
export async function resolveUserNames(prismaAuth: PrismaAuthService, ids: string[]): Promise<Map<string, ResolvedUserName>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();
  const users = await prismaAuth.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, firstName: true, surname: true },
  });
  return new Map(users.map((u) => [u.id, { firstName: u.firstName, surname: u.surname }]));
}
