import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { authClient } from '../api';
import { asyncStoragePersister } from '../lib/queryPersister';
import { registerForPushNotificationsAsync } from '../notifications/pushRegistration';
import { decodeJwtPayload } from './decodeJwt';
import { secureTokenStore } from './secureTokenStore';
import { setUnauthorizedHandler } from './sessionRefresh';
import { setCachedAccessToken } from './tokenCache';
import { isAccessTokenExpiredOrNearExpiry } from './tokenExpiry';
import type { JwtClaims } from './types';

/** Which School a multi-School coach/Branch Staff member is currently acting as
 * (Decision 184 item 4's own named follow-up: "no School switcher yet"). Plain
 * AsyncStorage, not SecureStore — same reasoning secureTokenStore's own header
 * comment gives for why AsyncStorage is wrong for the access/refresh token
 * (unencrypted) doesn't apply here: a School id isn't a secret, it's a UI
 * preference, the same class of thing asyncStoragePersister already persists
 * via this exact storage. A display/filter preference only, like every other
 * claim read in this file: `useCoachSchoolId()` below still only ever returns
 * a School the caller actually holds a current grant at. */
const ACTIVE_COACH_SCHOOL_KEY = 'ultm8.activeCoachSchoolId';

/** Decision 266 — Apple 4.2.6/4.3 compliance. The School a brand-new installer
 * picked on SchoolPickScreen, BEFORE they have an account — plain AsyncStorage,
 * same reasoning as ACTIVE_COACH_SCHOOL_KEY above (a display/routing
 * preference, not a secret). Cleared once they actually join that School
 * (JoinSchoolScreen's own success path) — this is intent, not membership;
 * useEnrolledSchoolIds() is the source of truth for the latter. Deliberately
 * NOT cleared by logout() — if someone logs out mid-flow before finishing
 * the join, the original pick should still be waiting for them next time. */
const PENDING_SCHOOL_PICK_KEY = 'ultm8.pendingSchoolPick';

interface PendingSchoolPick {
  id: string;
  name: string;
}

interface AuthContextValue {
  /** True while EITHER the stored token (SecureStore) or the pending
   * School-pick intent (AsyncStorage, Decision 266) is still being read at
   * app launch — both are async, unlike school-portal's sessionStorage, so
   * there's a real "don't know yet" state before RootNavigator's three-way
   * branch (SchoolPick vs. Auth vs. App) can be decided without a flash of
   * the wrong screen. */
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
  /** See `useCoachSchoolId`/`SchoolSwitcher` — the School a multi-School coach
   * has explicitly picked, if any. Most callers want `useCoachSchoolId()`
   * instead of reading this directly. */
  activeCoachSchoolId: string | null;
  setActiveCoachSchoolId: (schoolId: string) => void;
  /** See SchoolPickScreen/PENDING_SCHOOL_PICK_KEY above. */
  pendingSchoolPick: PendingSchoolPick | null;
  setPendingSchoolPick: (school: PendingSchoolPick) => void;
  clearPendingSchoolPick: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [tokenLoading, setLoading] = useState(true);
  // FOUND ON REVIEW — see the pendingSchoolPick-loading effect's own updated
  // comment below for the full account of why this exists.
  const [pendingSchoolPickLoaded, setPendingSchoolPickLoaded] = useState(false);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [activeCoachSchoolId, setActiveCoachSchoolIdState] = useState<string | null>(null);
  const [pendingSchoolPick, setPendingSchoolPickState] = useState<PendingSchoolPick | null>(null);

  // Derived, not its own state — claims are 100% a function of accessToken, so keeping
  // it in a separate useState risked a future call site updating one and forgetting the
  // other (caught in code review before this ever shipped, same discipline the backend
  // track uses).
  const claims = useMemo(() => (accessToken ? decodeJwtPayload<JwtClaims>(accessToken) : null), [accessToken]);

  const applyToken = useCallback(async (token: string) => {
    await secureTokenStore.set(token);
    setCachedAccessToken(token);
    setAccessTokenState(token);
  }, []);

  // Not gated behind `loading` above — unlike the access token, nothing in this
  // app's startup flow (login vs. home screen) depends on this value, so there's
  // no "don't know yet" state worth blocking on; it just catches up once read.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ACTIVE_COACH_SCHOOL_KEY)
      .then((stored) => {
        if (!cancelled && stored) setActiveCoachSchoolIdState(stored);
      })
      .catch(() => {
        /* noop — same degrade-to-first-School fallback as a failed read elsewhere */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveCoachSchoolId = useCallback((schoolId: string) => {
    setActiveCoachSchoolIdState(schoolId);
    AsyncStorage.setItem(ACTIVE_COACH_SCHOOL_KEY, schoolId).catch(() => {
      /* noop — a failed write just means this pick won't survive a restart */
    });
  }, []);

  // FOUND ON REVIEW: this used to NOT gate `loading`, on the reasoning that
  // RootNavigator falls back to "no pending pick" until this resolves — but
  // that's exactly backwards for RootNavigator's own three-way branch
  // (`!accessToken && !pendingSchoolPick`): a signed-out user who already
  // picked a School could see SchoolPickScreen flash again for the brief
  // window between the (separate, token-only) `loading` flag clearing and
  // this read actually finishing, since "no pending pick yet known" and
  // "genuinely no pending pick" were indistinguishable. `pendingSchoolPickLoaded`
  // below closes that window — `loading`'s exported value (end of this
  // function) now waits on both reads, not just the token one.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PENDING_SCHOOL_PICK_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          try {
            setPendingSchoolPickState(JSON.parse(stored) as PendingSchoolPick);
          } catch {
            /* noop — a corrupted stored value is treated the same as none */
          }
        }
      })
      .catch(() => {
        /* noop */
      })
      .finally(() => {
        if (!cancelled) setPendingSchoolPickLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPendingSchoolPick = useCallback((school: PendingSchoolPick) => {
    setPendingSchoolPickState(school);
    AsyncStorage.setItem(PENDING_SCHOOL_PICK_KEY, JSON.stringify(school)).catch(() => {
      /* noop — a failed write just means this pick won't survive a restart */
    });
  }, []);

  const clearPendingSchoolPick = useCallback(() => {
    setPendingSchoolPickState(null);
    AsyncStorage.removeItem(PENDING_SCHOOL_PICK_KEY).catch(() => {
      /* noop */
    });
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
      // Fire-and-forget — see pushRegistration.ts's own header comment.
      void registerForPushNotificationsAsync();
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
    setActiveCoachSchoolIdState(null);
    void AsyncStorage.removeItem(ACTIVE_COACH_SCHOOL_KEY).catch(() => {});
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
  // guarantee, not just cleanup. Also the proactive, on-launch path below calls this
  // directly, not just the reactive 401 path.
  const refreshSession = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = await secureTokenStore.getRefreshToken();
      if (!refreshToken) return null;
      const result = await unwrap(authClient.POST('/v1/auth/refresh', { body: { refreshToken } }));
      // LoginResponseDto's accessToken/refreshToken are typed optional only because
      // the DTO is shared with login()'s mustChangePasscode response (Decision
      // 1/230) — AuthService.refresh() itself (its own signature:
      // `Promise<{ accessToken: string; refreshToken: string }>`) never returns that
      // shape, it only ever throws or returns both. Narrowed here rather than
      // asserted, so a future change to that contract fails safe (falls into the
      // catch below, the same clean "session's over" path) instead of silently
      // storing `undefined` as a token.
      if (!result.accessToken || !result.refreshToken) {
        throw new Error('POST /auth/refresh returned no token pair');
      }
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
    let cancelled = false;
    (async () => {
      const token = await secureTokenStore.get();
      if (cancelled) return;
      // Track B roadmap's own flagged "Not yet" item, closed here: this used to
      // apply whatever token was in SecureStore unconditionally, even a dead one
      // left over from before the app was closed — the first real API call would
      // then 401 and the existing REACTIVE path (refreshSession via
      // onUnauthorized) would silently fix it, but only after that failed
      // request, with a brief flash/delay. Checking `exp` here lets the proactive
      // path refresh BEFORE ever rendering as logged-in with a token already (or
      // about to be, within the buffer) past its 15-minute TTL — reusing the same
      // refreshSession() the reactive path already uses, not a second mechanism.
      if (token && isAccessTokenExpiredOrNearExpiry(token)) {
        const refreshed = await refreshSession();
        if (!cancelled) setLoading(false);
        // Fire-and-forget, not awaited — see pushRegistration.ts's own header
        // comment. Re-registers (idempotent, lastSeenAt bump) on every launch
        // with an already-valid session, not just a fresh login below — this
        // branch still produces one if the refresh succeeded.
        if (refreshed) void registerForPushNotificationsAsync();
        return;
      }
      setCachedAccessToken(token);
      setAccessTokenState(token);
      setLoading(false);
      // Fire-and-forget — see comment above.
      if (token) void registerForPushNotificationsAsync();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => {
    setUnauthorizedHandler(refreshSession);
    return () => setUnauthorizedHandler(null);
  }, [refreshSession]);

  // FOUND ON REVIEW — see the pendingSchoolPick-loading effect's own comment:
  // `loading` must cover BOTH the token read and the pendingSchoolPick read,
  // so RootNavigator's three-way branch never makes its School-pick-vs-not
  // decision on a pendingSchoolPick value that just hasn't loaded yet.
  const loading = tokenLoading || !pendingSchoolPickLoaded;

  const value = useMemo(
    () => ({
      loading,
      accessToken,
      claims,
      login,
      logout,
      applyAccessToken: applyToken,
      activeCoachSchoolId,
      setActiveCoachSchoolId,
      pendingSchoolPick,
      setPendingSchoolPick,
      clearPendingSchoolPick,
    }),
    [
      loading,
      accessToken,
      claims,
      login,
      logout,
      applyToken,
      activeCoachSchoolId,
      setActiveCoachSchoolId,
      pendingSchoolPick,
      setPendingSchoolPick,
      clearPendingSchoolPick,
    ],
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

/** Every distinct School where this person coaches (Decisions 184, 186): an
 * Instructor or Branch Staff grant. Sorted, because the token's grants have no
 * guaranteed order (see useEnrolledSchoolIds). `SchoolSwitcher` is the one real
 * consumer of the full list; everywhere else wants `useCoachSchoolId()`. */
export function useCoachSchoolIds(): string[] {
  const { claims } = useAuth();
  if (!claims) return [];
  const ids = new Set(
    claims.grants.filter((g) => (g.role === 'INSTRUCTOR' || g.role === 'BRANCH_STAFF') && g.schoolId).map((g) => g.schoolId as string),
  );
  return [...ids].sort();
}

/** The School where this person is currently coaching (Decisions 184, 186). A
 * coach at several Schools can now pick which one (Decision 184 item 4,
 * resolved — see `SchoolSwitcher.tsx`); defaults to the first (stable sort
 * order, see useCoachSchoolIds) when nothing's been explicitly picked, or when
 * a previously-picked School is no longer in the caller's current grant set
 * (e.g. revoked) — never trusts the stored selection blindly against the live
 * claims. */
export function useCoachSchoolId(): string | null {
  const { activeCoachSchoolId } = useAuth();
  const schoolIds = useCoachSchoolIds();
  if (schoolIds.length === 0) return null;
  if (activeCoachSchoolId && schoolIds.includes(activeCoachSchoolId)) return activeCoachSchoolId;
  return schoolIds[0];
}
