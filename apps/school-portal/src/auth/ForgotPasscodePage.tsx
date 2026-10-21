import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, PhoneField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';

export function ForgotPasscodePage() {
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Trans k="auth.forgot.remembered" nodes={{ link: <Link to="/login">{t('auth.logIn')}</Link> }} />
      }
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.phoneLabel')} htmlFor="forgot-phone">
          <PhoneField required value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {t('auth.forgot.sendCode')}
        </Button>
      </form>
    </AuthCard>
  );
}
