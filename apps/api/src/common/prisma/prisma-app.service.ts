import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContext } from '../request-context';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** The transaction withTenantContext is currently running, so a call made from
 * inside it for the same user reuses it (see withTenantContext). */
const openTenantTx = new AsyncLocalStorage<{ client: PrismaAppService; userId: string; impersonationSchoolId: string | undefined; tx: TenantTx; open: boolean }>();

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
export class PrismaAppService extends PrismaClient implements OnModuleDestroy {
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
   *
   * A call made from inside another withTenantContext for the same user (and the
   * same impersonation scope) runs in that open transaction instead of starting a
   * second one. Before this, a check such as TenantAuthorizationService.
   * assertSchoolOwner() called inside a transaction held one pooled connection
   * while waiting for another: with as many such requests at once as the pool
   * has connections, every one waited until Prisma's 2 s maxWait and failed
   * ("busy", 503). The billing stress test of 26 Oct 2026 found it on
   * PATCH /transactions/:id/confirm: 5,917 of 6,071 confirmations failed.
   */
  async withTenantContext<T>(
    userId: string,
    fn: (tx: TenantTx) => Promise<T>,
    options?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<T> {
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId() ?? undefined;
    const outer = openTenantTx.getStore();
    if (outer && outer.open && outer.client === this && outer.userId === userId && outer.impersonationSchoolId === impersonationSchoolId) {
      return fn(outer.tx);
    }
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
        // `open` is cleared when this transaction ends, so work started inside it
        // but still running afterwards opens its own transaction.
        const store = { client: this, userId, impersonationSchoolId, tx, open: true };
        try {
          return await openTenantTx.run(store, () => fn(tx));
        } finally {
          store.open = false;
        }
      },
      options?.timeoutMs || options?.maxWaitMs
        ? { ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}), ...(options.maxWaitMs ? { maxWait: options.maxWaitMs } : {}) }
        : undefined,
    );
  }

  /**
   * withTenantContext plus the coach invite token's hash (Decision 183), so
   * CoachInvite's token-holder policies let the caller read and accept that one
   * invite. The hash is SHA-256 hex, checked before it is set.
   */
  async withCoachInviteToken<T>(
    userId: string,
    tokenHash: string,
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('Invalid coach invite token hash');
    return this.withTenantContext(userId, async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.coach_invite_token_hash = '${tokenHash}'`);
      return fn(tx);
    });
  }

  /**
   * A transaction for a guest waiver link's holder (Waivers Q9): no signed-in
   * user, only the link token's hash, so GuestWaiverSignature's token-holder
   * policies let it sign for that one booking seat. The hash is SHA-256 hex,
   * checked before it is set.
   */
  async withGuestWaiverToken<T>(tokenHash: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('Invalid guest waiver token hash');
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.guest_waiver_token_hash = '${tokenHash}'`);
      return fn(tx);
    });
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

  /** Close this client's connection pool when the app shuts down (app.close(),
   * SIGTERM), so a restarted process or a test suite that starts the app
   * repeatedly doesn't leave connections open until the process exits. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
