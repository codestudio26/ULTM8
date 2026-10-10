import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { platformAdminSessionStorageTokenStore, decodeJwtPayload } from '@ultm8/auth';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { generateCodeChallenge, generateCodeVerifier, generateRandomToken, savePkceFlowState, takePkceFlowState } from './pkce';
import type { AdminJwtClaims } from './types';

/** Cognito Hosted UI config. apps/api's own PlatformAdminAuthController/
 * CognitoTokenVerifierService document Authorization Code + PKCE as the
 * flow this app is expected to run (see pkce.ts's own header comment for the
 * full reasoning, including why an earlier Implicit-grant draft was wrong). */
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const COGNITO_REDIRECT_URI = import.meta.env.VITE_COGNITO_REDIRECT_URI;

/** Whether this deployment actually has a Cognito Pool to point at — real AWS
 * infrastructure this codebase cannot provision itself (see .env.example). The
 * login screen reads this to show a clear "not configured" message instead of
 * building a broken redirect URL when it's unset, same "degrade rather than
 * crash" convention apps/api's own unconfigured-external-dependency services use
 * (CognitoTokenVerifierService, PrismaAppService, etc). */
export const isCognitoConfigured = Boolean(COGNITO_DOMAIN && COGNITO_CLIENT_ID && COGNITO_REDIRECT_URI);

interface CognitoIdTokenClaims {
  nonce?: string;
}

interface AuthContextValue {
  accessToken: string | null;
  claims: AdminJwtClaims | null;
  /** Redirects the browser to Cognito's own Hosted UI to begin the
   * Authorization Code + PKCE flow — there is no in-app email/password form;
   * Cognito's page collects the credential (and enforces Required MFA at the
   * Pool's own configuration, Spec §4.4). */
  beginCognitoLogin: () => Promise<void>;
  /** Completes the flow: exchanges the `code` Cognito's redirect handed back
   * for an ID token (a direct, CORS-enabled fetch to Cognito's own token
   * endpoint — no backend-for-frontend involved), validates `state`/`nonce`,
   * then hands that ID token to POST /platform-admin/auth/exchange for
   * ULTM8's own Platform Admin JWT. */
  completeCognitoLogin: (code: string, returnedState: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readClaims(): { accessToken: string | null; claims: AdminJwtClaims | null } {
  const token = platformAdminSessionStorageTokenStore.get();
  if (!token) return { accessToken: null, claims: null };
  const claims = decodeJwtPayload<AdminJwtClaims>(token);
  return { accessToken: token, claims };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ accessToken, claims }, setState] = useState(readClaims);
  const queryClient = useQueryClient();

  const beginCognitoLogin = useCallback(async () => {
    // Re-checked here (not just via isCognitoConfigured, which LoginPage already
    // gates the button on) so TypeScript can actually narrow these three from
    // `string | undefined` to `string` — a module-level derived boolean doesn't
    // narrow the separate consts it was computed from.
    if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID || !COGNITO_REDIRECT_URI) return;

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomToken();
    const nonce = generateRandomToken();
    savePkceFlowState({ codeVerifier, state, nonce });

    const url = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', COGNITO_CLIENT_ID);
    url.searchParams.set('redirect_uri', COGNITO_REDIRECT_URI);
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.assign(url.toString());
  }, []);

  const completeCognitoLogin = useCallback(async (code: string, returnedState: string) => {
    const flow = takePkceFlowState();
    if (!flow || flow.state !== returnedState) {
      // Either no flow was ever started in this tab, or `state` doesn't match
      // what beginCognitoLogin() generated — CSRF protection: refuse rather
      // than proceed with a code that may have been substituted from a
      // different login attempt.
      throw new Error('This sign-in attempt could not be verified — please try again.');
    }
    if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID || !COGNITO_REDIRECT_URI) {
      throw new Error('Cognito is not configured for this environment.');
    }

    // Direct browser -> Cognito token-endpoint fetch, no backend-for-frontend —
    // this is exactly the property PKCE gives a public client. Cognito's token
    // endpoint is CORS-enabled for App Clients with no client secret.
    const tokenRes = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: COGNITO_CLIENT_ID,
        code,
        redirect_uri: COGNITO_REDIRECT_URI,
        code_verifier: flow.codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error('Cognito rejected the sign-in attempt — please try again.');
    }
    const body = (await tokenRes.json()) as { id_token?: string };
    if (!body.id_token) {
      throw new Error('Cognito did not return an ID token.');
    }

    // Defense-in-depth nonce check — apps/api's own CognitoTokenVerifierService
    // already verifies signature/iss/aud/token_use/expiry server-side (see that
    // class's own header comment); this check adds what only the browser that
    // started the flow can know: that this ID token was actually issued in
    // response to ITS OWN authorize request, not replayed from elsewhere.
    const idTokenClaims = decodeJwtPayload<CognitoIdTokenClaims>(body.id_token);
    if (idTokenClaims?.nonce !== flow.nonce) {
      throw new Error('This sign-in attempt could not be verified — please try again.');
    }

    const result = await unwrap(apiClient.POST('/v1/platform-admin/auth/exchange', { body: { idToken: body.id_token } }));
    platformAdminSessionStorageTokenStore.set(result.accessToken);
    setState(readClaims());
  }, []);

  const logout = useCallback(() => {
    platformAdminSessionStorageTokenStore.clear();
    setState({ accessToken: null, claims: null });
    // Same reasoning as apps/school-portal's own AuthContext.logout() (Phase 24
    // finding): drop every cached query, not just some of them, so a second
    // Platform Admin signing in right after on a shared machine never sees a
    // flash of the first caller's cached data.
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ accessToken, claims, beginCognitoLogin, completeCognitoLogin, logout }),
    [accessToken, claims, beginCognitoLogin, completeCognitoLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
