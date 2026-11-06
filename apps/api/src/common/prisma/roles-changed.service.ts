import { Injectable } from '@nestjs/common';
import { PrismaAuthService } from './prisma-auth.service';

/** How long one API instance trusts the stamp it last read for a user. A
 * change made through another instance (or a job) is seen within this time. */
const CACHE_MS = 5_000;

/**
 * Decision 361 — "when did this user's roles last change?", read on every
 * authenticated request by JwtStrategy. The answer is `User.rolesChangedAt`,
 * which a trigger on RoleGrant keeps current for every path that touches a
 * grant (see migration 20261211000000_user_roles_changed_at).
 *
 * Read through PrismaAuthService (the pre-tenant-context, SELECT-only role):
 * the check runs before any tenant context exists. Each instance keeps the
 * answer for a few seconds so a busy user costs one primary-key lookup per
 * CACHE_MS, not one per request; RoleGrantsService calls forget() after its
 * own changes so the Staff page's actions take effect on the very next request.
 * A failed read throws, so JwtStrategy refuses the request rather than letting
 * a possibly-removed person through.
 */
@Injectable()
export class RolesChangedService {
  private readonly cache = new Map<string, { stamp: number; locked: boolean; readAt: number }>();

  constructor(private readonly prismaAuth: PrismaAuthService) {}

  /** The stamp as epoch milliseconds, 0 when the user's roles never changed. */
  async stampFor(userId: string): Promise<number> {
    return (await this.stateFor(userId)).stamp;
  }

  /** "Delete my account": true while the account's deletion is pending, or
   * once it is erased. Read with the stamp, in the same lookup. */
  async isLocked(userId: string): Promise<boolean> {
    return (await this.stateFor(userId)).locked;
  }

  private async stateFor(userId: string): Promise<{ stamp: number; locked: boolean }> {
    const now = Date.now();
    const hit = this.cache.get(userId);
    if (hit && now - hit.readAt < CACHE_MS) return hit;
    const user = await this.prismaAuth.user.findUnique({
      where: { id: userId },
      select: { rolesChangedAt: true, deletionRequestedAt: true, erasedAt: true },
    });
    const entry = { stamp: user?.rolesChangedAt?.getTime() ?? 0, locked: !!(user?.deletionRequestedAt || user?.erasedAt), readAt: now };
    this.cache.set(userId, entry);
    if (this.cache.size > 10_000) this.evictOld(now);
    return entry;
  }

  forget(userId: string): void {
    this.cache.delete(userId);
  }

  private evictOld(now: number): void {
    for (const [id, entry] of this.cache) {
      if (now - entry.readAt >= CACHE_MS) this.cache.delete(id);
    }
  }
}
