import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { asyncStoragePersister } from '../lib/queryPersister';
import { decodeJwtPayload } from './decodeJwt';
import { secureTokenStore } from './secureTokenStore';
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
      const result = await unwrap(apiClient.POST('/v1/auth/login', { body: { email, passcode } }));
      await applyToken(result.accessToken);
    },
    [applyToken],
  );

  const logout = useCallback(async () => {
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

  const value = useMemo(
    () => ({ loading, accessToken, claims, login, logout }),
    [loading, accessToken, claims, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Mirrors apps/school-portal/src/auth/AuthContext.tsx's own `useOwnedSchoolId` —
 * same shape, STUDENT role instead of SCHOOL_OWNER_MANAGER. Resolves to exactly
 * ONE School, sorted deterministically (not "first in the array") since a person
 * can hold the same role at more than one School (skills/ultm8-domain-rules/
 * SKILL.md §6.1/§8.3, [CONFIRMED]) and the JWT's `grants` array has no guaranteed
 * order (AuthService's token issuance has no `orderBy` on the RoleGrants it
 * signs in). A known, deliberate scope limit for a multi-School Student, not a
 * silent shortcut — proper multi-School support is a separate follow-up. */
export function useEnrolledSchoolId(): string | null {
  const { claims } = useAuth();
  if (!claims) return null;
  const schoolIds = claims.grants.filter((g) => g.role === 'STUDENT' && g.schoolId).map((g) => g.schoolId as string);
  return schoolIds.sort()[0] ?? null;
}

/** Same "derive from claims.grants" shape as useEnrolledSchoolId, for the
 * one other role check this app makes — Guardian is a boolean presence
 * check (any active GUARDIAN grant, not scoped to a School) rather than a
 * value to resolve, so this returns boolean instead of string | null. */
export function useIsGuardian(): boolean {
  const { claims } = useAuth();
  return claims?.grants.some((g) => g.role === 'GUARDIAN') ?? false;
}
