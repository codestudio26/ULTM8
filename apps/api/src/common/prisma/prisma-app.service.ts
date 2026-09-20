import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContext } from '../request-context';

/**
 * The connection apps/api uses for every tenant-scoped query, authenticated as the
 * `ultm8_app` Postgres role (see prisma/migrations/20260902000000_init/migration.sql).
 * `ultm8_app` is deliberately not the table owner and not a superuser, so the RLS
 * policies on User/RoleGrant/Franchise/School/Branch actually apply to it.
 *
 * Every tenant-scoped read/write MUST go through `withTenantContext`, not the bare
 * Prisma client — a plain query on this client runs with no `app.current_user_id` set,
 * which RLS treats as "no context" and correctly returns zero rows rather than
 * silently bypassing isolation (ultm8-tenant-isolation §2: "a query missing a tenant
 * filter returns nothing").
 *
 * NOTE: this is not connected eagerly on module init — Prisma connects lazily on the
 * first query. That's deliberate: it lets apps/api boot and serve non-DB routes (e.g.
 * Swagger) even when no Postgres instance is reachable, rather than crashing startup.
 */
@Injectable()
export class PrismaAppService extends PrismaClient {
  private readonly logger = new Logger(PrismaAppService.name);

  constructor() {
    const url = process.env.DATABASE_URL_APP;
    if (!url) {
      // Don't throw here — allow the app to boot (e.g. for `nest start` smoke-testing
      // without a database configured yet). Any actual query will fail loudly instead.
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaAppService] DATABASE_URL_APP is not set — tenant-scoped queries will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }

  /**
   * Runs `fn` inside a transaction with `app.current_user_id` set via SET LOCAL for
   * its duration — the one and only way RLS policies see a caller identity. `userId`
   * must be the caller's own User.id; for registration, pass the freshly-generated id
   * of the row about to be inserted (see AuthService.register()).
   *
   * `options.timeoutMs` — Phase 16b-ii addition, found necessary on review: Prisma's
   * own interactive-transaction default timeout is 5000ms, fine for every existing
   * call site in this codebase (pure DB work, no external I/O inside the
   * transaction), but too short for FranchiseFeesService.refund()'s own deliberate
   * exception to this codebase's usual "no external I/O inside a transaction" rule
   * (see that method's own comment for why it holds a row lock across two sequential
   * Stripe API calls). Optional and defaults to Prisma's own default when omitted —
   * every existing call site is unaffected.
   *
   * Phase 47 — also sets `app.impersonation_school_id` whenever `RequestContext`
   * carries one (populated by `JwtStrategy.validate()` from an active impersonation
   * token's own `impersonation.schoolId` claim; see that file's and `RequestContext`'s
   * own comments). No caller of this method passes anything new — the scoping is
   * picked up automatically from the current request's own async context, the same
   * "one central choke point" reasoning `app.current_user_id` itself already relies
   * on. Absent/empty for every ordinary (non-impersonated) call, which is every call
   * site that existed before this phase — see migration
   * `20261002000000_impersonation_scope_rls_fix`'s own header comment for why that
   * makes this additive-only in practice: `current_setting(..., true)` returns NULL
   * when unset, and every RLS check this feeds short-circuits to its original,
   * unmodified behavior in that case.
   */
  async withTenantContext<T>(
    userId: string,
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        // SET LOCAL cannot take a bind parameter for the identifier position in all
        // drivers reliably across Prisma versions — use $executeRawUnsafe with a
        // validated, engine-generated UUID string only (never raw user input).
        if (!isUuid(userId)) {
          this.logger.error(`Refusing to set tenant context to non-UUID value: ${userId}`);
          throw new Error('Invalid tenant context id');
        }
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
        await this.setImpersonationScopeIfPresent(tx);
        return fn(tx);
      },
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
  }

  /** Shared by withTenantContext/withMultiTenantContext — see withTenantContext's own
   * header comment for the full Phase 47 account. Same UUID validation as userId
   * above, and for the identical reason (SET LOCAL can't bind-parameter an
   * identifier-position value; this is engine-generated, per Prisma.RoleGrant.schoolId
   * @id @default(uuid()), never raw user input — AuthService.issueImpersonationToken()
   * already 404s before this if `schoolId` doesn't correspond to a real, active grant). */
  private async setImpersonationScopeIfPresent(
    tx: Pick<PrismaClient, '$executeRawUnsafe'>,
  ): Promise<void> {
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    if (!impersonationSchoolId) return;
    if (!isUuid(impersonationSchoolId)) {
      this.logger.error(`Refusing to set impersonation scope to non-UUID value: ${impersonationSchoolId}`);
      throw new Error('Invalid impersonation scope id');
    }
    await tx.$executeRawUnsafe(`SET LOCAL app.impersonation_school_id = '${impersonationSchoolId}'`);
  }

  /**
   * FOUND ON REVIEW (Phase 12, GuardiansService.createMinor()): the rare case
   * where ONE transaction needs to act under TWO DIFFERENT tenant identities in
   * sequence — e.g. bootstrapping a brand-new minor's own User row (which must
   * run under THAT row's own about-to-exist id, the same trick
   * AuthService.register() already established), then immediately linking it
   * under the calling Guardian's own identity. Two separate `withTenantContext`
   * calls cannot guarantee this atomically — each opens and commits its OWN
   * transaction, so a failure on the second call leaves the first one's write
   * permanently committed with no rollback. `fn` receives a `setContext(userId)`
   * callback to switch identity mid-transaction (re-validated on every call, same
   * as `withTenantContext` itself) and the shared `tx` to run queries against.
   *
   * Phase 47 — also sets the impersonation scope on every `setContext` call, same
   * as `withTenantContext` (see that method's own comment). Not reachable by an
   * impersonation token in practice today — every current caller of this method
   * (e.g. GuardiansService.createMinor()) is a WRITE, and JwtStrategy already
   * rejects every write carrying an impersonation claim before it reaches a
   * controller — but kept consistent with withTenantContext rather than leaving
   * these two near-identical methods silently diverge on this.
   */
  async withMultiTenantContext<T>(
    fn: (
      tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
      setContext: (userId: string) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      const setContext = async (userId: string) => {
        if (!isUuid(userId)) {
          this.logger.error(`Refusing to set tenant context to non-UUID value: ${userId}`);
          throw new Error('Invalid tenant context id');
        }
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
        await this.setImpersonationScopeIfPresent(tx);
      };
      return fn(tx, setContext);
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
