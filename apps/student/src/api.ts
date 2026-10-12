import Constants from 'expo-constants';
import { createApiClient } from '@ultm8/api-client';
import { getCachedAccessToken } from './auth/tokenCache';
import { handleUnauthorized } from './auth/sessionRefresh';

export const baseUrl =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

/** The one apps/api client instance for the whole app — always reads the current
 * token fresh from the in-memory cache AuthContext maintains (see auth/tokenCache.ts
 * for why this can't read SecureStore directly here), so a login/logout is reflected
 * on the very next call. `onUnauthorized` is the same bridge pattern for the one
 * other thing AuthContext owns that this module-level client needs — see
 * auth/sessionRefresh.ts. */
export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: () => getCachedAccessToken(),
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
 * request's own retry), not a clean "invalid email or passcode" error. Everything
 * else in this app (every screen, every other query/mutation) is a genuinely
 * token-authenticated call and keeps using `apiClient` above. */
export const authClient = createApiClient({ baseUrl });
