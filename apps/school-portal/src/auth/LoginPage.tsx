import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, AuthSuccessCard, Button, ErrorBanner, Field, PasscodeField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };

  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, passcode);
      setLoggedIn(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleContinue() {
    navigate(location.state?.from?.pathname ?? '/', { replace: true });
  }

  if (loggedIn) {
    return (
      <AuthSuccessCard
        title="Successful"
        subtitle="You are successfully logged in to your account."
        onContinue={handleContinue}
      />
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Email and your 6-digit passcode — that's your whole login (no separate password)."
      rail={
        <div className="ultm8-auth-rail">
          <span className="ultm8-auth-rail__mark" aria-hidden="true">
            U8
          </span>
          <div className="ultm8-auth-rail__copy">
            <strong>ULTM8</strong>
            Every belt, every booking, one place.
          </div>
        </div>
      }
      footer={<>New School? <Link to="/register">Create an account</Link></>}
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email" htmlFor="login-email">
          <TextField
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Passcode"
          htmlFor="login-passcode"
          hint="6 digits"
          labelAction={
            <Link to="/forgot-passcode" className="ultm8-field__label-action">
              Forgot your passcode?
            </Link>
          }
        >
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="current-password"
            required
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          Log in
        </Button>
      </form>
    </AuthCard>
  );
}
