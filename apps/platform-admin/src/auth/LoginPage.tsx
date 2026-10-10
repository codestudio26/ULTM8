import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { isCognitoConfigured, useAuth } from './AuthContext';

export function LoginPage() {
  const { beginCognitoLogin, completeCognitoLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  // Redirect handling must run exactly once per return from Cognito, not once
  // per render — StrictMode's dev-only double-invoke would otherwise attempt
  // the code exchange twice against an authorization code that's only valid
  // once (Cognito rejects a reused code outright).
  const attempted = useRef(false);

  useEffect(() => {
    // Authorization Code flow returns `code`/`state` as QUERY parameters, not
    // a URL fragment (contrast the Implicit grant, which never got past
    // review — see pkce.ts's own header comment) — a query string a proxy or
    // access log could still see, but it's a short-lived, single-use
    // authorization code, not a bearer token itself.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || attempted.current) return;
    attempted.current = true;

    // Clear the query string immediately, before the exchange even resolves —
    // same "don't leave it sitting in browser history/address-bar
    // autocomplete" reasoning as the token itself (see @ultm8/auth's own
    // header comment on the sessionStorage choice).
    window.history.replaceState(null, '', window.location.pathname);

    setExchanging(true);
    completeCognitoLogin(code, state)
      .then(() => {
        navigate(location.state?.from?.pathname ?? '/', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not complete sign-in — please try again.');
        setExchanging(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // fires once on mount; completeCognitoLogin/navigate/location are stable
    // enough in practice and re-running this on their identity churn would
    // re-trigger an exchange against an already-cleared query string.
  }, []);

  if (exchanging) {
    return (
      <AuthCard title="Signing in…" subtitle="Verifying your Cognito session.">
        <Spinner />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Platform Admin"
      subtitle="Sign in with your company identity provider. A dedicated realm, separate from tenant accounts (Spec §4.4) — mandatory 2FA is enforced by the identity provider itself, not by this app."
    >
      {error ? <ErrorBanner message={error} /> : null}
      {isCognitoConfigured ? (
        <Button fullWidth onClick={() => void beginCognitoLogin()}>
          Sign in with Cognito
        </Button>
      ) : (
        <ErrorBanner message="Cognito is not configured for this environment — VITE_COGNITO_DOMAIN / VITE_COGNITO_CLIENT_ID / VITE_COGNITO_REDIRECT_URI are unset. See .env.example." />
      )}
    </AuthCard>
  );
}
