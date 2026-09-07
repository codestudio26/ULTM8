import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_jobs` Postgres role (see Phase 5's
 * 20260908000000_timetable_module migration) — for background jobs with no single
 * caller/tenant context to run `PrismaAppService.withTenantContext(callerId, ...)`
 * under. Same shape as PrismaAuthService (own connection string, own narrowly-scoped
 * additive RLS policies): SELECT on TimetableSlot and Branch, INSERT+SELECT on Class
 * (the SELECT is for Prisma's `.create()`-implied `RETURNING`, not independent reads —
 * see the migration's own header comment) — nothing else, no UPDATE/DELETE anywhere.
 * Don't broaden a call site here into a general-purpose cross-tenant read/write; add
 * the specific grant a new job actually needs, in its own migration, the same way this
 * one did.
 *
 * Plain `console.warn`, not a `Logger` field, before `super()` — same reason
 * PrismaAppService/PrismaAuthService both do this: TypeScript doesn't allow `this` to
 * be touched (including reading an initialized class field) before `super()` runs in a
 * derived class.
 */
@Injectable()
export class PrismaJobsService extends PrismaClient {
  constructor() {
    const url = process.env.DATABASE_URL_JOBS;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaJobsService] DATABASE_URL_JOBS is not set — background jobs will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }
}
