import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, PhoneField, SegmentedCodeInput, SuccessBanner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useT } from '../i18n/I18nProvider';

export function VerifyOtpPage() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
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
      setError(err instanceof ApiError ? err.message : t('auth.verify.resendFailed'));
    }
  }

  return (
    <AuthCard title={t('auth.verify.title')} subtitle={t('auth.verify.subtitle')}>
      <form onSubmit={handleVerify}>
        {error ? <ErrorBanner message={error} /> : null}
        {resent ? <SuccessBanner message={t('auth.verify.resent')} /> : null}
        <Field label={t('auth.phoneLabel')} htmlFor="verify-phone">
          <PhoneField required value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('auth.verificationCodeLabel')} htmlFor="verify-code">
          <SegmentedCodeInput value={code} onChange={setCode} autoFocus required />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {t('auth.verify.submit')}
        </Button>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Button type="button" variant="secondary" onClick={handleResend}>
            {t('auth.verify.resend')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
