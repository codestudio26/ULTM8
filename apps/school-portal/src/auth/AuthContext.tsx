import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionStorageTokenStore, decodeJwtPayload } from '@ultm8/auth';
import { unwrap } from '@ultm8/api-client';
import { authClient } from '../api';
import { markVerifyNoticeDue } from './verifyNoticeFlag';
import { setUnauthorizedHandler } from './sessionRefresh';
import type { JwtClaims } from './types';

interface AuthContextValue {
  accessToken: string | null;
  claims: JwtClaims | null;
  /**
   * Login is email + passcode only — Decision 72, the passcode is the sole
   * credential, not a step-up factor alongside OTP.
   *
   * Decision 1/230 — resolves to `{ mustChangePasscode: true,
   * passcodeChangeToken }` instead of applying a token when a
   * server-generated temp passcode (Instructor "Add Manually") is still
   * pending a change — no token is stored yet in that case; the caller
   * navigates to the first-login passcode-change flow with that token.
   */
  login: (email: string, passcode: string) => Promise<{ mustChangePasscode: true; passcodeChangeToken: string } | void>;
  logout: () => Promise<void>;
  /**
   * Swaps in an already-obtained token without hitting /auth/login — for the one
   * narrow, approved case (ultm8-nestjs-module §7): SchoolsService.create() re-mints
   * the caller's own token after granting them SCHOOL_OWNER_MANAGER and returns it in
   * the School response, so CreateSchoolPage can apply it directly instead of forcing
   * a log-out/back-in. Not a general-purpose token setter for anything else — the
   * invite-grant case and every other "caller's grants might be stale" spot stays
   * inside the accepted staleness window on purpose (same section).
   */
  setAccessToken: (token: string) => void;
  /** Starts a brand-new session from a token pair the API just issued — login()
   * and the first-login passcode change. Drops everything a previous session in
   * this tab left behind first (its refresh token, cached data and School
   * choice), so nothing of the last person carries over (sign-in review A2, A4). */
  startSession: (accessToken: string, refreshToken: string) => void;
  /** See `useCoachSchoolId`/`SchoolSwitcher` — the School a multi-School coach
   * has explicitly picked, if any. Most callers want `useCoachSchoolId()`
   * instead of reading this directly. */
  activeCoachSchoolId: string | null;
  setActiveCoachSchoolId: (schoolId: string) => void;
  /** See `useOwnedSchoolId`/`SchoolSwitcher` — the School a multi-School Owner
   * has explicitly picked, if any. Most callers want `useOwnedSchoolId()`
   * instead of reading this directly. A separate key/state from the coach one
   * above — Decision 255 deliberately left this as its own piece of scope, not
   * folded into the coach switcher, since the same person could in principle
   * be both (own one School, coach at another), and each needs to resolve
   * independently. */
  activeOwnedSchoolId: string | null;
  setActiveOwnedSchoolId: (schoolId: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Which School a multi-School coach/Branch Staff member is currently acting as
 * (Decision 184 item 4's own named follow-up: "no School switcher yet"). Same
 * sessionStorage reasoning as `sessionStorageTokenStore` — tab-scoped, cleared on
 * logout, not a standing cross-session artifact — but a separate key so it isn't
 * confused with the token itself. A display/filter preference only, like every
 * other claim read in this file: `useCoachSchoolId()` below still only ever
 * returns a School the caller actually holds a current grant at, and every API
 * call it feeds into is re-checked server-side regardless. */
const ACTIVE_COACH_SCHOOL_KEY = 'ultm8.activeCoachSchoolId';
/** Same shape as the coach key above, for a multi-School Owner — see
 * `useOwnedSchoolId`'s own header comment for why this is a separate key
 * rather than reusing the coach one. */
const ACTIVE_OWNED_SCHOOL_KEY = 'ultm8.activeOwnedSchoolId';

function readActiveSchoolId(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeActiveSchoolId(key: string, schoolId: string | null) {
  try {
    if (schoolId) sessionStorage.setItem(key, schoolId);
    else sessionStorage.removeItem(key);
  } catch {
    /* noop — same degrade-to-first-School fallback as a failed read */
  }
}

function readClaims(): { accessToken: string | null; claims: JwtClaims | null } {
  const token = sessionStorageTokenStore.get();
  if (!token) return { accessToken: null, claims: null };
  const claims = decodeJwtPayload<JwtClaims>(token);
  return { accessToken: token, claims };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ accessToken, claims }, setState] = useState(readClaims);
  const [activeCoachSchoolId, setActiveCoachSchoolIdState] = useState(() => readActiveSchoolId(ACTIVE_COACH_SCHOOL_KEY));
  const [activeOwnedSchoolId, setActiveOwnedSchoolIdState] = useState(() => readActiveSchoolId(ACTIVE_OWNED_SCHOOL_KEY));
  const queryClient = useQueryClient();

  const setActiveCoachSchoolId = useCallback((schoolId: string) => {
    writeActiveSchoolId(ACTIVE_COACH_SCHOOL_KEY, schoolId);
    setActiveCoachSchoolIdState(schoolId);
  }, []);

  const setActiveOwnedSchoolId = useCallback((schoolId: string) => {
    writeActiveSchoolId(ACTIVE_OWNED_SCHOOL_KEY, schoolId);
    setActiveOwnedSchoolIdState(schoolId);
  }, []);

  const applyToken = useCallback((token: string) => {
    sessionStorageTokenStore.set(token);
    setState(readClaims());
  }, []);

  const startSession = useCallback(
    (accessToken: string, refreshToken: string) => {
      queryClient.clear();
      writeActiveSchoolId(ACTIVE_COACH_SCHOOL_KEY, null);
      writeActiveSchoolId(ACTIVE_OWNED_SCHOOL_KEY, null);
      setActiveCoachSchoolIdState(null);
      setActiveOwnedSchoolIdState(null);
      // Refresh token first, then the access token — applyToken is what flips
      // `accessToken` state, so ordering it last means the refresh token is
      // already persisted by the time anything could possibly need it. Same
      // ordering apps/student's own login() already established.
      sessionStorageTokenStore.setRefreshToken(refreshToken);
      applyToken(accessToken);
      markVerifyNoticeDue();
    },
    [applyToken, queryClient],
  );

  const login = useCallback(
    async (email: string, passcode: string) => {
      const result = await unwrap(authClient.POST('/v1/auth/login', { body: { email, passcode } }));
      if (result.mustChangePasscode) {
        return { mustChangePasscode: true as const, passcodeChangeToken: result.passcodeChangeToken! };
      }
      startSession(result.accessToken!, result.refreshToken!);
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    // Best-effort server-side revoke before the local clear below — without this, a
    // "logged out" refresh token was still live and redeemable (apps/api's
    // /auth/logout exists exactly to revoke it; nothing here ever called it until
    // now). Silently succeeds for an unknown/already-revoked token
    // (AuthService.logout()'s own doc comment), so this is safe to call even on a
    // token that's about to be cleared regardless. A failed revoke (offline,
    // server error) must never block actually signing the person out of THIS tab —
    // that's the one thing they asked for — so it's swallowed, not surfaced or
    // retried. Same shape apps/student's own logout() already established.
    const refreshToken = sessionStorageTokenStore.getRefreshToken();
    if (refreshToken) {
      await unwrap(authClient.POST('/v1/auth/logout', { body: { refreshToken } })).catch(() => {});
    }
    sessionStorageTokenStore.clear();
    writeActiveSchoolId(ACTIVE_COACH_SCHOOL_KEY, null);
    writeActiveSchoolId(ACTIVE_OWNED_SCHOOL_KEY, null);
    setState({ accessToken: null, claims: null });
    setActiveCoachSchoolIdState(null);
    setActiveOwnedSchoolIdState(null);
    // FOUND ON REVIEW (Phase 24, surfaced by the new Notifications inbox —
    // the first query in this codebase keyed with no per-caller scoping
    // identifier at all, e.g. `['notifications']` vs. every other query's
    // `['branches', schoolId]`-shaped key): without this, react-query's
    // cache outlives logout, so on a shared/front-desk machine a second
    // Staff member logging in right after (no full page reload happens on
    // logout) would briefly see the FIRST caller's cached data before the
    // background refetch replaces it. `clear()` drops every cached query,
    // not just Notifications' — closes the whole class of gap, not one
    // instance of it.
    queryClient.clear();
  }, [queryClient]);

  // The one answer to `createApiClient`'s `onUnauthorized` (api.ts and
  // auth/sessionRefresh.ts) — apps/api mints a 15-minute access token, so this is
  // the ordinary mid-session case, not a rare edge case. MUST resolve, never throw
  // (that option's own contract in packages/api-client) — the catch below is that
  // guarantee, not just cleanup. Same shape, same reasoning, as apps/student's own
  // refreshSession().
  const refreshSession = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = sessionStorageTokenStore.getRefreshToken();
      if (!refreshToken) return null;
      const result = await unwrap(authClient.POST('/v1/auth/refresh', { body: { refreshToken } }));
      if (!result.accessToken || !result.refreshToken) {
        throw new Error('POST /auth/refresh returned no token pair');
      }
      // Rotated (AuthService.refresh()'s own doc comment: the presented token is
      // revoked in the same step a successor is issued) — the OLD refresh token is
      // now dead, so the new one must be persisted before anything else can use it.
      sessionStorageTokenStore.setRefreshToken(result.refreshToken);
      applyToken(result.accessToken);
      return result.accessToken;
    } catch {
      // The refresh token itself is no good any more — expired (30-day TTL),
      // explicitly revoked, or (AuthService.refresh()'s reuse-detection) already
      // redeemed by someone replaying it. Either way the session is genuinely over,
      // not a transient failure worth leaving the person stranded on a screen that
      // will just 401 forever: end it the same way the explicit "Log out" button
      // does. logout() re-reads the refresh token and tries to revoke it too;
      // that's a harmless no-op here (it's already no good), not worth a
      // special-cased skip.
      await logout();
      return null;
    }
  }, [applyToken, logout]);

  useEffect(() => {
    setUnauthorizedHandler(refreshSession);
    return () => setUnauthorizedHandler(null);
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      accessToken,
      claims,
      login,
      logout,
      setAccessToken: applyToken,
      startSession,
      activeCoachSchoolId,
      setActiveCoachSchoolId,
      activeOwnedSchoolId,
      setActiveOwnedSchoolId,
    }),
    [accessToken, claims, login, logout, applyToken, startSession, activeCoachSchoolId, setActiveCoachSchoolId, activeOwnedSchoolId, setActiveOwnedSchoolId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Every distinct School the caller owns (`SCHOOL_OWNER_MANAGER`) — sorted for a
 * stable, deterministic order, same reasoning as `useCoachSchoolIds` (the JWT's
 * `grants` array carries no ordering guarantee). Nothing in the schema stops a
 * `User` holding `SCHOOL_OWNER_MANAGER` at more than one School (no
 * `@@unique([userId, role])` on `RoleGrant`) — found while building Decision 255's
 * coach switcher, deliberately left as its own follow-up at the time, now closed
 * here. `SchoolSwitcher` is the one real consumer of the full list; everywhere
 * else wants `useOwnedSchoolId()`. */
export function useOwnedSchoolIds(): string[] {
  const { claims } = useAuth();
  if (!claims) return [];
  const ids = new Set(claims.grants.filter((g) => g.role === 'SCHOOL_OWNER_MANAGER' && g.schoolId).map((g) => g.schoolId as string));
  return [...ids].sort();
}

/** The School the caller is currently acting as Owner of — used to decide whether
 * to show onboarding (Phase 3 item 3) or the School dashboard (item 4). This is a
 * display hint only, decoded client-side, never trusted for authorization —
 * apps/api re-checks every grant server-side on every request regardless (see
 * TenantAuthorizationService's header comment on the backend).
 *
 * Defaults to the first School (stable sort order, see useOwnedSchoolIds) when
 * nothing has been explicitly picked yet, or when a previously-picked School is
 * no longer in the caller's current grant set — never trusts the stored
 * selection blindly against the live claims. Same shape as `useCoachSchoolId`
 * (Decision 255); kept as a separate active-selection state since an Owner could
 * in principle also coach at a different School, and each needs to resolve
 * independently. */
export function useOwnedSchoolId(): string | null {
  const { activeOwnedSchoolId } = useAuth();
  const schoolIds = useOwnedSchoolIds();
  if (schoolIds.length === 0) return null;
  if (activeOwnedSchoolId && schoolIds.includes(activeOwnedSchoolId)) return activeOwnedSchoolId;
  return schoolIds[0];
}

/** Every distinct School a coach or Branch Staff member works at (Decision 184;
 * Branch Staff get the same screens, Phase 7) — sorted for a stable, deterministic
 * order (the JWT's own `grants` array carries no ordering guarantee; AuthService's
 * token issuance has no `orderBy`), so the default selection in `useCoachSchoolId`
 * below doesn't vary between logins for the same coach. `SchoolSwitcher` is the
 * one real consumer of the full list; everywhere else wants `useCoachSchoolId()`. */
export function useCoachSchoolIds(): string[] {
  const { claims } = useAuth();
  if (!claims) return [];
  const ids = new Set(claims.grants.filter((g) => (g.role === 'INSTRUCTOR' || g.role === 'BRANCH_STAFF') && g.schoolId).map((g) => g.schoolId as string));
  return [...ids].sort();
}

/** The School a coach or Branch Staff member is currently acting as (Decision 184
 * item 4, resolved: a School switcher now exists — see `SchoolSwitcher.tsx`). A
 * display hint only, like useOwnedSchoolId; the API re-checks every grant
 * server-side regardless.
 *
 * Defaults to the first School (stable sort order, see useCoachSchoolIds) when
 * nothing has been explicitly picked yet, or when a previously-picked School is
 * no longer in the caller's current grant set (e.g. it was revoked, or this is a
 * stale selection left over from a different account in the same browser tab) —
 * never trusts the stored selection blindly against the live claims. */
export function useCoachSchoolId(): string | null {
  const { activeCoachSchoolId } = useAuth();
  const schoolIds = useCoachSchoolIds();
  if (schoolIds.length === 0) return null;
  if (activeCoachSchoolId && schoolIds.includes(activeCoachSchoolId)) return activeCoachSchoolId;
  return schoolIds[0];
}

/** True for a coach or Branch Staff member who doesn't own a School — the one test
 * that picks the coach sidebar over the owner's (Shell.tsx), and that the header's
 * account menu and Global Search follow so they never drift from the sidebar. */
export function useIsCoachOnly(): boolean {
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  return !ownedSchoolId && !!coachSchoolId;
}

/** The School the grading screens work in: the owner's, else the coach's. */
export function useGradingSchoolId(): string | null {
  const owned = useOwnedSchoolId();
  const coached = useCoachSchoolId();
  return owned ?? coached;
}
