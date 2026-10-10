import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_auth` Postgres role. This exists for
 * lookups/writes that inherently have no tenant/shared-RoleGrant context yet
 * to go through the ordinary RLS-scoped PrismaAppService path: the
 * pre-authentication credential-lookup path (login-by-email, registration's
 * already-taken check), RoleGrantsService's target-user existence check (id
 * only — no verification precondition on the target as of Decision 81, which
 * put that check on the grantor instead, looked up via the caller's own
 * ordinary self-scoped RLS access, not this service), which hits the same
 * structural gap (a School Owner/Manager inviting a brand-new Instructor/
 * Branch Staff has no RoleGrant linking them to that person yet, so
 * `user_self_or_shared_school` would correctly show nothing) — and, as of the
 * refresh-token endpoint, the entire pre-session token lifecycle (refresh,
 * logout, the passcode-reset mass-revoke), which hits the identical "no
 * session/tenant context established yet" gap for a bare presented token.
 *
 * FOUND ON REVIEW: previously claimed "SELECT-only on User, nothing else" —
 * now stale/false. On `User` it's still SELECT-only (user_auth_lookup policy,
 * no tenant restriction by design; don't broaden a call site into a
 * general-purpose cross-tenant User read). On `RefreshToken` it also holds
 * SELECT/INSERT/UPDATE (refresh_token_auth_realm_only policy) — never DELETE,
 * same "flip status, don't delete" convention as everywhere else in this
 * codebase. Every User-table call site still selects the minimum fields
 * needed and never writes to User through this connection.
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
