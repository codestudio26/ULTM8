import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Phase 47 — the propagation mechanism behind the impersonation-scope RLS fix
 * (Spec 55 §12.1 Decision 39; see the migration's own header comment,
 * 20261002000000_impersonation_scope_rls_fix, for the full account of what this
 * closes and why).
 *
 * A plain module-level AsyncLocalStorage, not a NestJS request-scoped provider —
 * PrismaAppService is a singleton (one connection pool for the whole process), and
 * making it request-scoped just to read one value would cascade request-scoping
 * through every module that injects it. AsyncLocalStorage gives the same
 * per-request isolation without that cost: each concurrent request gets its own
 * store, correctly separated by Node's own async-causality tracking, regardless of
 * how many requests share the same singleton service instances.
 *
 * ESTABLISHED by RequestContextMiddleware (apps/api/src/common/middleware/
 * request-context.middleware.ts), registered globally in AppModule so it runs for
 * every request BEFORE Passport/JwtStrategy — middleware is used deliberately
 * instead of an interceptor specifically so the store exists as a single mutable
 * object for the entire request lifecycle before req.user is even populated;
 * JwtStrategy.validate() (the one central choke point every tenant request already
 * passes through — see that file's own comment) then MUTATES this same object once
 * the token's own impersonation claim is known, rather than needing its own
 * separate `.run()` call. `PrismaAppService.withTenantContext` reads the same store
 * much later, from inside whatever service the controller calls.
 */
export interface RequestContextStore {
  impersonationSchoolId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  /** Establishes an empty, mutable store for the remainder of the current async
   * causality chain — called once per request, from RequestContextMiddleware. */
  run<T>(fn: () => T): T {
    return storage.run({}, fn);
  },

  /** Called from JwtStrategy.validate() once an impersonation token's own claim is
   * decoded — a no-op if RequestContextMiddleware didn't run first (e.g. a unit
   * test constructing JwtStrategy directly), matching PrismaAppService's own
   * "impersonation scoping is additive, never assumed present" treatment below. */
  setImpersonationSchoolId(schoolId: string): void {
    const store = storage.getStore();
    if (store) store.impersonationSchoolId = schoolId;
  },

  getImpersonationSchoolId(): string | undefined {
    return storage.getStore()?.impersonationSchoolId;
  },
};
