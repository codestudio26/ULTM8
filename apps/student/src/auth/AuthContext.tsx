import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { authClient } from '../api';
import { asyncStoragePersister } from '../lib/queryPersister';
import { decodeJwtPayload } from './decodeJwt';
import { secureTokenStore } from './secureTokenStore';
import { setUnauthorizedHandler } from './sessionRefresh';
import { setCachedAccessToken } from './tokenCache';
import type { JwtClaims } from './types';

interface AuthContextValue {
  /** True while the stored token is still being read from SecureStore at app launch —
   * SecureStore is async, unlike school-portal's sessionStorage, so there's a real
   * "don't know yet" state before the first screen decision (login vs. home) can be
   * made. */
  loading: boolean;
  accessToken: string | null;
  claims: JwtClaims | null;
  /** Login is email + passcode only — Decision 72, the passcode is the sole
   * credential, not a step-up factor alongside OTP. */
  login: (email: string, passcode: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Swap in a fresh access token the API handed back, e.g. after joining a
   * School, whose new STUDENT grant only exists in a newly minted token. */
  applyAccessToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);

  // Derived, not its own state — claims are 100% a function of accessToken, so keeping
  // it in a separate useState risked a future call site updating one and forgetting the
  // other (caught in code review before this ever shipped, same discipline the backend
  // track uses).
  const claims = useMemo(() => (accessToken ? decodeJwtPayload<JwtClaims>(accessToken) : null), [accessToken]);

  useEffect(() => {
    let cancelled = false;
    secureTokenStore.get().then((token) => {
      if (cancelled) return;
      setCachedAccessToken(token);
      setAccessTokenState(token);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyToken = useCallback(async (token: string) => {
    await secureTokenStore.set(token);
    setCachedAccessToken(token);
    setAccessTokenState(token);
  }, []);

  const login = useCallback(
    async (email: string, passcode: string) => {
      const result = await unwrap(authClient.POST('/v1/auth/login', { body: { email, passcode } }));
      // Decision 1/230 — login() can also resolve to a mustChangePasscode
      // response (a server-generated temp passcode pending a change), but
      // that's an Instructor "Add Manually" concern — school-portal's own
      // sign-in, not this Student/Guardian app's. Surfaced as a clear error
      // rather than silently assumed away. LoginResponseDto's own header
      // comment confirms accessToken/refreshToken are always present or absent
      // TOGETHER, so this one check covers both before either is used below.
      if (!result.accessToken || !result.refreshToken) {
        throw new Error('This account requires a passcode change — sign in on the School Portal first.');
      }
      // Refresh token first, then the access token — applyToken is what flips
      // `accessToken` state and sends the app from AuthNavigator to AppNavigator, so
      // ordering it last means the refresh token is already persisted by the time
      // anything could possibly need it.
      await secureTokenStore.setRefreshToken(result.refreshToken);
      await applyToken(result.accessToken);
    },
    [applyToken],
  );

  const logout = useCallback(async () => {
    // Best-effort server-side revoke before the local clear below — without this, a
    // "logged out" refresh token was still live and redeemable (apps/api's /auth/
    // logout exists exactly to revoke it; nothing here ever called it until now).
    // Silently succeeds for an unknown/already-revoked token (AuthService.logout's
    // own doc comment), so this is safe to call even on a token that's about to be
    // cleared regardless. A failed revoke (offline, server error) must never block
    // actually signing the person out of THIS device — that's the one thing they
    // asked for — so it's swallowed, not surfaced or retried.
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) {
      await unwrap(authClient.POST('/v1/auth/logout', { body: { refreshToken } })).catch(() => {});
    }
    await secureTokenStore.clear();
    setCachedAccessToken(null);
    setAccessTokenState(null);
    // The device may be shared (e.g. a Guardian's phone used by more than one Student
    // login) — without this, react-query's cache would show the previous account's
    // cached My Bookings/Academies data for a moment after the next login, since no
    // query key here is scoped by user id. Found on review, before this ever shipped.
    queryClient.clear();
    // FOUND ON REVIEW: this does NOT reliably "win" against queryClient.clear()'s own
    // effect on the persisted copy — clear()'s cache-event notifications are deferred
    // (react-query's notifyManager batches them via setTimeout(fn, 0), a macrotask),
    // so the persist subscription's own write can still land after this call,
    // re-creating an entry under the same key. That's not a data leak — clear() has
    // already synchronously emptied the in-memory cache by the time that deferred
    // write's own dehydrate() runs, so at worst it re-writes an empty snapshot, never
    // the previous account's real data — but this call is a best-effort belt-and-
    // braces attempt, not the guaranteed-immediate clear an earlier version of this
    // comment claimed. `.catch` swallows a rejected AsyncStorage.removeItem (e.g. a
    // storage I/O error) rather than leaving an unhandled promise rejection at the
    // exact moment a user expects a clean logout; maxAge already bounds how long any
    // leftover entry could matter regardless.
    void Promise.resolve(asyncStoragePersister.removeClient()).catch(() => {});
  }, [queryClient]);

  // The one answer to `createApiClient`'s `onUnauthorized` (see api.ts and
  // auth/sessionRefresh.ts) — apps/api mints a 15-minute access token, so this is
  // the ordinary mid-session case, not a rare edge case. MUST resolve, never throw
  // (that option's own contract in packages/api-client) — the catch below is that
  // guarantee, not just cleanup.
  const refreshSession = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = await secureTokenStore.getRefreshToken();
      if (!refreshToken) return null;
      const result = await unwrap(authClient.POST('/v1/auth/refresh', { body: { refreshToken } }));
      // Rotated (AuthService.refresh()'s own doc comment: the presented token is
      // revoked in the same step a successor is issued) — the OLD refresh token is
      // now dead, so the new one must be persisted before anything else can use it.
      await secureTokenStore.setRefreshToken(result.refreshToken);
      await applyToken(result.accessToken);
      return result.accessToken;
    } catch {
      // The refresh token itself is no good any more — expired (30-day TTL),
      // explicitly revoked, or (AuthService.refresh()'s reuse-detection) already
      // redeemed by someone replaying it. Either way the session is genuinely over,
      // not a transient failure worth leaving the person stranded on a screen that
      // will just 401 forever: end it the same way the explicit "Log out" button
      // does, which sends them back to the login screen via the existing
      // accessToken-gated RootNavigator. logout() re-reads the refresh token and
      // tries to revoke it too; that's a harmless no-op here (it's already no good),
      // not worth a special-cased skip.
      await logout();
      return null;
    }
  }, [applyToken, logout]);

  useEffect(() => {
    setUnauthorizedHandler(refreshSession);
    return () => setUnauthorizedHandler(null);
  }, [refreshSession]);

  const value = useMemo(
    () => ({ loading, accessToken, claims, login, logout, applyAccessToken: applyToken }),
    [loading, accessToken, claims, login, logout, applyToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Every School a Student holds a STUDENT RoleGrant at — a person can hold the same
 * role at more than one School (skills/ultm8-domain-rules/SKILL.md §6.1/§8.3,
 * [CONFIRMED]). Deduplicated (a School could in principle appear via more than one
 * grant row) and sorted deterministically, since the JWT's `grants` array has no
 * guaranteed order (AuthService's token issuance has no `orderBy` on the RoleGrants
 * it signs in) — a caller that only needs one stable id can still take `[0]`.
 * Previously resolved to a single School only (`useEnrolledSchoolId`, replaced
 * here) — WaiversScreen is the only caller, and now handles every enrolled School
 * itself rather than silently dropping the rest for a multi-School Student. */
export function useEnrolledSchoolIds(): string[] {
  const { claims } = useAuth();
  if (!claims) return [];
  const schoolIds = new Set(claims.grants.filter((g) => g.role === 'STUDENT' && g.schoolId).map((g) => g.schoolId as string));
  return Array.from(schoolIds).sort();
}

/** Same "derive from claims.grants" shape as useEnrolledSchoolIds, for the
 * one other role check this app makes — Guardian is a boolean presence
 * check (any active GUARDIAN grant, not scoped to a School) rather than a
 * value to resolve, so this returns boolean instead of string | null. */
export function useIsGuardian(): boolean {
  const { claims } = useAuth();
  return claims?.grants.some((g) => g.role === 'GUARDIAN') ?? false;
}

/** The School where this person coaches (Decisions 184, 186): an Instructor or
 * Branch Staff grant. A coach at several Schools sees one of them for now (no
 * School switcher yet, Decision 184 item 4); sorted, because the token's grants
 * have no guaranteed order (see useEnrolledSchoolIds). */
export function useCoachSchoolId(): string | null {
  const { claims } = useAuth();
  if (!claims) return null;
  const ids = claims.grants
    .filter((g) => (g.role === 'INSTRUCTOR' || g.role === 'BRANCH_STAFF') && g.schoolId)
    .map((g) => g.schoolId as string)
    .sort();
  return ids[0] ?? null;
}
