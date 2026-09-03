import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, TextField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

export function ForgotPasscodePage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Always responds success regardless of whether the phone is registered
      // (AuthService.requestPasscodeReset — account-enumeration hygiene), so this
      // always proceeds to the reset screen rather than branching on the result.
      await unwrap(apiClient.POST('/v1/auth/forgot-password', { body: { phone } }));
      navigate('/reset-passcode', { state: { phone } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your passcode"
      subtitle="We'll text a verification code to your phone."
      footer={
        <>
          Remembered it? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Phone" htmlFor="forgot-phone" hint="E.164 format, e.g. +15551234567">
          <TextField type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          Send code
        </Button>
      </form>
    </AuthCard>
  );
}
