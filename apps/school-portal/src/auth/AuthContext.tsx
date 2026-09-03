import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
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

  const login = useCallback(async (email: string, passcode: string) => {
    const result = await unwrap(apiClient.POST('/v1/auth/login', { body: { email, passcode } }));
    sessionStorageTokenStore.set(result.accessToken);
    setState(readClaims());
  }, []);

  const logout = useCallback(() => {
    sessionStorageTokenStore.clear();
    setState({ accessToken: null, claims: null });
  }, []);

  const value = useMemo(() => ({ accessToken, claims, login, logout }), [accessToken, claims, login, logout]);

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
