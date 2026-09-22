import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, AuthSuccessCard, Button, ErrorBanner, Field, PasscodeField, SegmentedCodeInput, TextField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

export function ResetPasscodePage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { phone?: string } };
  const [phone, setPhone] = useState(location.state?.phone ?? '');
  const [code, setCode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPasscode !== confirmPasscode) {
      setError('New passcode and confirmation must match.');
      return;
    }

    setSubmitting(true);
    try {
      await unwrap(apiClient.POST('/v1/auth/reset-password', { body: { phone, code, newPasscode } }));
      setChanged(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (changed) {
    return (
      <AuthSuccessCard
        title="Passcode changed"
        subtitle="Log in with your new 6-digit passcode."
        onContinue={() => navigate('/login')}
      />
    );
  }

  return (
    <AuthCard title="Set a new passcode" subtitle="Enter the code we sent, then choose a new 6-digit passcode.">
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Phone" htmlFor="reset-phone" hint="E.164 format, e.g. +15551234567">
          <TextField type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Verification code" htmlFor="reset-code">
          <SegmentedCodeInput value={code} onChange={setCode} />
        </Field>
        <Field label="New passcode" htmlFor="reset-newPasscode" hint="6 digits">
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={newPasscode}
            onChange={(e) => setNewPasscode(e.target.value)}
          />
        </Field>
        <Field label="Confirm new passcode" htmlFor="reset-confirmPasscode">
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={confirmPasscode}
            onChange={(e) => setConfirmPasscode(e.target.value)}
          />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          Set new passcode
        </Button>
      </form>
    </AuthCard>
  );
}
