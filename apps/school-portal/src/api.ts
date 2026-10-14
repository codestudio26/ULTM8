import { createApiClient } from '@ultm8/api-client';
import { sessionStorageTokenStore } from '@ultm8/auth';
import { handleUnauthorized } from './auth/sessionRefresh';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** The one apps/api client instance for the whole app — always reads the current
 * token fresh from the store (see @ultm8/auth's header comment for the storage
 * decision), never caches it, so a login/logout is reflected on the very next call.
 * `onUnauthorized` transparently refreshes a 15-minute-expired access token mid-
 * session instead of leaving every subsequent call 401ing — see auth/sessionRefresh.ts
 * for the bridge to AuthContext's refreshSession(), the same split apps/student's
 * own api.ts already established for the identical gap on that app. */
export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: () => sessionStorageTokenStore.get(),
  onUnauthorized: () => handleUnauthorized(),
});

/**
 * A second, deliberately plain client — no `onUnauthorized` — for AuthContext's own
 * three direct calls to AuthModule's credential-exchange endpoints
 * (login/refresh/logout). Those can each genuinely return a real 401 that means
 * something other than "this access token expired, go refresh it" (login: wrong
 * passcode; refresh: the refresh token itself is invalid/expired/already used) — if
 * either went through `apiClient`'s retry middleware, that 401 would be read as
 * "refresh and retry," calling straight back into `handleUnauthorized` ->
 * `refreshSession` -> this exact same request, which can only ever get the same 401
 * again: a hung promise (the retry awaits a refresh that recursively awaits this
 * request's own retry), not a clean "invalid email or passcode" error. Same split,
 * same reasoning, as `apps/student/src/api.ts`'s own `authClient`. Everywhere else in
 * this app keeps using `apiClient` above.
 */
export const authClient = createApiClient({ baseUrl });
