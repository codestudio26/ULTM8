/**
 * RFC 7636 (Authorization Code + PKCE) helpers — the flow apps/api's own
 * PlatformAdminAuthController/CognitoTokenVerifierService already document as
 * what they expect ("the frontend completes Cognito's own Hosted-UI +
 * Authorization-Code-with-PKCE flow"). PKCE exists specifically so a public
 * client (a browser SPA with no client secret) can use the Authorization Code
 * flow safely — there's no backend-for-frontend requirement here; the code
 * exchange runs as a direct, CORS-enabled fetch from the browser to Cognito's
 * own token endpoint. An earlier draft of this app used the Implicit grant
 * instead on the mistaken assumption that PKCE needed a confidential client —
 * caught on review before this shipped; Implicit grant is also deprecated in
 * OAuth 2.1 for exposing tokens in the URL fragment/browser history with no
 * corresponding security benefit over PKCE for a public client.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A cryptographically random string, unreserved-charset-safe per RFC 7636 §4.1
 * (43-128 chars) — 32 random bytes base64url-encoded lands at 43 chars. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** S256 challenge derived from the verifier (RFC 7636 §4.2) — sent in the
 * authorize request; Cognito's token endpoint later verifies the verifier we
 * send during the code exchange hashes to this same value. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Random token for the OAuth `state` param (CSRF — binds the browser that
 * started the flow to the one that completes it) and reused for the OIDC
 * `nonce` param (ID-token replay binding) as two independently generated
 * values, not the same string for both. */
export function generateRandomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * The in-flight flow's own {codeVerifier, state, nonce} — generated in
 * beginCognitoLogin(), needed again once the browser returns from Cognito's
 * Hosted UI. sessionStorage survives that round-trip (same tab, same origin
 * before/after — only the intermediate hop to Cognito's own domain is
 * cross-origin, which doesn't clear this tab's storage for OUR origin), and is
 * cleared the moment it's read back so a stale value can never be replayed
 * against a later, unrelated login attempt. A DIFFERENT key from
 * @ultm8/auth's platformAdminSessionStorageTokenStore — this holds transient
 * OAuth flow state, never the resulting access token itself.
 */
const FLOW_STATE_KEY = 'ultm8.platformAdmin.oauthFlow';

export interface PkceFlowState {
  codeVerifier: string;
  state: string;
  nonce: string;
}

export function savePkceFlowState(flow: PkceFlowState): void {
  try {
    sessionStorage.setItem(FLOW_STATE_KEY, JSON.stringify(flow));
  } catch {
    /* Private-browsing/storage-disabled — beginCognitoLogin's redirect still
       happens; the callback will simply fail state validation and show the
       ordinary "could not complete sign-in" error rather than crashing. */
  }
}

/** Reads AND clears in one call — a stored flow state is single-use. */
export function takePkceFlowState(): PkceFlowState | null {
  try {
    const raw = sessionStorage.getItem(FLOW_STATE_KEY);
    sessionStorage.removeItem(FLOW_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PkceFlowState;
  } catch {
    return null;
  }
}
