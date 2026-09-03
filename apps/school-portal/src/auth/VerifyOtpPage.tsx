import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { phone?: string } };
  const [phone, setPhone] = useState(location.state?.phone ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await unwrap(apiClient.POST('/v1/auth/otp/verify', { body: { phone, code } }));
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setResent(false);
    try {
      await unwrap(apiClient.POST('/v1/auth/otp/send', { body: { phone } }));
      setResent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    }
  }

  return (
    <AuthCard title="Verify your phone" subtitle="Enter the code we sent to complete registration.">
      <form onSubmit={handleVerify}>
        {error ? <ErrorBanner message={error} /> : null}
        {resent ? <SuccessBanner message="Code resent." /> : null}
        <Field label="Phone" htmlFor="verify-phone" hint="E.164 format, e.g. +15551234567">
          <TextField type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Verification code" htmlFor="verify-code">
          <TextField required value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          Verify
        </Button>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Button type="button" variant="secondary" onClick={handleResend}>
            Resend code
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
