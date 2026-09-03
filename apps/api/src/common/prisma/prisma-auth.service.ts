import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_auth` Postgres role — SELECT-only on `User`,
 * nothing else (see migration.sql). This exists for lookups that inherently have no
 * tenant/shared-RoleGrant context yet to go through the ordinary RLS-scoped
 * PrismaAppService path: the pre-authentication credential-lookup path (login-by-email,
 * registration's already-taken check), and — extended in Phase 2 —
 * RoleGrantsService's target-user existence check (id only — no verification
 * precondition on the target as of Decision 81, which put that check on the grantor
 * instead, looked up via the caller's own ordinary self-scoped RLS access, not this
 * service), which hits the same structural gap (a School Owner/Manager inviting a
 * brand-new Instructor/Branch Staff has no RoleGrant linking them to that person yet,
 * so `user_self_or_shared_school` would correctly show nothing). Both call sites select
 * the minimum fields needed (never a full profile) and never write anything — this
 * connection deliberately cannot. Its RLS policy (user_auth_lookup) has no tenant
 * restriction by design; don't broaden a call site here into a general-purpose
 * cross-tenant User read.
 */
@Injectable()
export class PrismaAuthService extends PrismaClient {
  constructor() {
    const url = process.env.DATABASE_URL_AUTH;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaAuthService] DATABASE_URL_AUTH is not set — login/registration lookups will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }
}
