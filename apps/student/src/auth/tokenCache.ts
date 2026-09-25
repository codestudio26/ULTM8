/**
 * `@ultm8/api-client`'s `getAccessToken` middleware callback is synchronous (it runs
 * once per outgoing request, on every request) — fine for school-portal's
 * `sessionStorage`, but `expo-secure-store` is async, so the API client can't read it
 * directly. This is a small in-memory mirror of "whatever AuthContext currently holds":
 * AuthContext is the only writer (on launch-load, login, and logout), api.ts is the
 * only reader. Not a second source of truth — SecureStore stays the persisted one,
 * this just bridges the sync/async gap for the one callback that needs it.
 */
let currentAccessToken: string | null = null;

export function getCachedAccessToken(): string | null {
  return currentAccessToken;
}

export function setCachedAccessToken(token: string | null): void {
  currentAccessToken = token;
}
