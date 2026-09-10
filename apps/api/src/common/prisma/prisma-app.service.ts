import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
        return fn(tx);
      },
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
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
      };
      return fn(tx, setContext);
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
