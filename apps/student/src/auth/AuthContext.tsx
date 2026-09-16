import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
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
