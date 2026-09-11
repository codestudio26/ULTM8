import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionStorageTokenStore, decodeJwtPayload } from '@ultm8/auth';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import type { JwtClaims } from './types';

interface AuthContextValue {
  accessToken: string | null;
  claims: JwtClaims | null;
  /** Login is email + passcode only — Decision 72, the passcode is the sole
   * credential, not a step-up factor alongside OTP. */
  login: (email: string, passcode: string) => Promise<void>;
  logout: () => void;
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readClaims(): { accessToken: string | null; claims: JwtClaims | null } {
  const token = sessionStorageTokenStore.get();
  if (!token) return { accessToken: null, claims: null };
  const claims = decodeJwtPayload<JwtClaims>(token);
  return { accessToken: token, claims };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ accessToken, claims }, setState] = useState(readClaims);
  const queryClient = useQueryClient();

  const applyToken = useCallback((token: string) => {
    sessionStorageTokenStore.set(token);
    setState(readClaims());
  }, []);

  const login = useCallback(
    async (email: string, passcode: string) => {
      const result = await unwrap(apiClient.POST('/v1/auth/login', { body: { email, passcode } }));
      applyToken(result.accessToken);
    },
    [applyToken],
  );

  const logout = useCallback(() => {
    sessionStorageTokenStore.clear();
    setState({ accessToken: null, claims: null });
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

  const value = useMemo(
    () => ({ accessToken, claims, login, logout, setAccessToken: applyToken }),
    [accessToken, claims, login, logout, applyToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** The caller's own SCHOOL_OWNER_MANAGER grant, if any — used to decide whether to
 * show onboarding (Phase 3 item 3) or the School dashboard (item 4). This is a display
 * hint only, decoded client-side, never trusted for authorization — apps/api re-checks
 * every grant server-side on every request regardless (see
 * TenantAuthorizationService's header comment on the backend). */
export function useOwnedSchoolId(): string | null {
  const { claims } = useAuth();
  if (!claims) return null;
  const grant = claims.grants.find((g) => g.role === 'SCHOOL_OWNER_MANAGER' && g.schoolId);
  return grant?.schoolId ?? null;
}
