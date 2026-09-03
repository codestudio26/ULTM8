import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, TextField } from '@ultm8/ui';
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, passcode);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Log in"
      subtitle="Email and your 6-digit passcode — that's your whole login (no separate password)."
      footer={
        <>
          New School? <Link to="/register">Create an account</Link>
          <br />
          Forgot your passcode? <Link to="/forgot-passcode">Reset it</Link>
        </>
      }
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
        <Field label="Passcode" htmlFor="login-passcode" hint="6 digits">
          <TextField
            type="password"
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
