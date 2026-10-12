/**
 * Bridges `api.ts` (reader) to `AuthContext` (the one writer, registered once on
 * mount) for the one thing `createApiClient`'s `onUnauthorized` needs that isn't
 * just "the current token" — a way to ask for a fresh one when a request 401s.
 * Same `AuthContext`-writes/`api.ts`-reads split as `tokenCache.ts`, and for the
 * same reason: `api.ts` is a module-level singleton created before `AuthProvider`
 * ever mounts, so it can't call a hook directly.
 *
 * `onUnauthorized`'s own doc comment in packages/api-client requires this to never
 * throw/reject — enforced here too, not just trusted of the registered handler,
 * since a thrown rejection reaching the single-flight `refreshing` promise in
 * createRefreshMiddleware would propagate somewhere that contract says it can't.
 */
let handler: (() => Promise<string | null>) | null = null;

export function setUnauthorizedHandler(fn: (() => Promise<string | null>) | null): void {
  handler = fn;
}

export async function handleUnauthorized(): Promise<string | null> {
  if (!handler) return null;
  try {
    return await handler();
  } catch {
    return null;
  }
}
