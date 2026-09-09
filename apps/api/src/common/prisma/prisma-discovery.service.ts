import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_discovery` Postgres role (see Phase 14's
 * 20260917000000_academies_discovery_module migration) — a dedicated, narrowly-
 * scoped LOGIN role for AcademiesModule's cross-School discovery reads, exactly
 * the same shape as PrismaJobsService/PrismaAuthService (own connection string,
 * own additive RLS policies, own column-level GRANTs granting exactly what it
 * needs and nothing else). See Decision 94 (docs/decisions/POST-SPEC-55-DECISION-
 * LOG.md) for the full reasoning, including why this deliberately does NOT reuse
 * `ultm8_app` (the role every other interactive query in this codebase already
 * runs under — a policy widening that role's SELECT would have silently broken
 * tenant isolation on every other module reading these same tables, caught on
 * this PR's own code review before it ever shipped) or `ultm8_jobs` (a
 * semantically different role for background jobs and narrow same-School
 * aggregate reads, not this module's genuinely cross-tenant, open-ended
 * enumeration).
 *
 * ONLY AcademiesService may inject this. Don't broaden a call site here into a
 * general-purpose cross-tenant read for another module — add that module's own
 * narrowly-scoped role/policy, the same way this one and ultm8_jobs each did,
 * rather than reusing this connection for an unrelated purpose.
 *
 * Plain `console.warn`, not a `Logger` field, before `super()` — same reason
 * PrismaAppService/PrismaAuthService/PrismaJobsService all do this: TypeScript
 * doesn't allow `this` to be touched (including reading an initialized class
 * field) before `super()` runs in a derived class.
 */
@Injectable()
export class PrismaDiscoveryService extends PrismaClient {
  constructor() {
    const url = process.env.DATABASE_URL_DISCOVERY;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaDiscoveryService] DATABASE_URL_DISCOVERY is not set — AcademiesModule will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }
}
