import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_platform_admin` Postgres role (see
 * apps/api/prisma/migrations/20260925000000_platform_admin_audit_log/migration.sql)
 * — a dedicated, narrowly-scoped LOGIN role for PlatformAdminModule's cross-tenant
 * business-logic reads and AuditLogEntry writes, exactly the same shape as
 * PrismaDiscoveryService/PrismaJobsService/PrismaAuthService (own connection
 * string, own additive RLS policies, own column-level GRANTs granting exactly what
 * it needs and nothing else). See that migration's own comment for the full
 * reasoning, including why this deliberately does NOT reuse `ultm8_app` (a policy
 * widening that role's SELECT would silently broaden visibility for every other
 * endpoint already using it — the exact mistake academies_discovery_module's own
 * migration comment documents being caught before it shipped) or `ultm8_discovery`
 * (a different caller population and a different, narrower curated-column shape —
 * AcademiesModule's own public-discovery view, not Platform Admin's fuller
 * support-facing one).
 *
 * FOUND ON REVIEW (Phase 26): a first draft put this file inside
 * apps/api/src/platform-admin/ instead of here, alongside PrismaAppService/
 * PrismaAuthService/PrismaJobsService/PrismaDiscoveryService — the established,
 * 4-for-4 convention this codebase already has for "every role-scoped Prisma
 * client lives in the shared, `@Global()` PrismaModule, discoverable in one place
 * for review/audit," not declared inside whichever feature module happens to use
 * it first. Moved here to match.
 *
 * NOT used for AdminUser lookups — those stay on the bare PrismaAppService client,
 * unchanged from Phase 25's Slice 1 (see PlatformAdminAuthService's own header
 * comment for why: AdminUser has no RLS policy at all, so there is nothing this
 * role's own additive policies would need to bypass for that table specifically).
 *
 * ONLY PlatformAdminModule's own services may inject this. Don't broaden a call
 * site here into a general-purpose cross-tenant read for another module — add that
 * module's own narrowly-scoped role/policy instead, the same way this one and
 * ultm8_discovery each did.
 */
@Injectable()
export class PrismaPlatformAdminService extends PrismaClient {
  constructor() {
    const url = process.env.DATABASE_URL_PLATFORM_ADMIN;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaPlatformAdminService] DATABASE_URL_PLATFORM_ADMIN is not set — PlatformAdminModule\'s cross-tenant reads will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }
}
