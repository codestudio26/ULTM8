import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, AuthSuccessCard, Button, ErrorBanner, Field, PasscodeField, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from './AuthContext';
import { takeReturnTo } from './returnTo';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';

export function LoginPage() {
  const t = useT();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string }; phoneVerified?: boolean } };

  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // An unverified phone gets a link to the Verify phone page (A6).
  const [needsVerifying, setNeedsVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerifying(false);
    setSubmitting(true);
    try {
      const result = await login(email, passcode);
      if (result?.mustChangePasscode) {
        navigate('/first-login-passcode-change', { state: { passcodeChangeToken: result.passcodeChangeToken, from: location.state?.from } });
        return;
      }
      setLoggedIn(true);
    } catch (err) {
      setNeedsVerifying(err instanceof ApiError && err.code === 'PHONE_NOT_VERIFIED');
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleContinue() {
    navigate(location.state?.from?.pathname ?? takeReturnTo() ?? '/', { replace: true });
  }

  if (loggedIn) {
    return (
      <AuthSuccessCard
        title={t('auth.login.successTitle')}
        subtitle={t('auth.login.successSubtitle')}
        onContinue={handleContinue}
      />
    );
  }

  return (
    <AuthCard
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      rail={
        <div className="ultm8-auth-rail">
          <span className="ultm8-auth-rail__mark" aria-hidden="true">
            U8
          </span>
          <div className="ultm8-auth-rail__copy">
            <strong>ULTM8</strong>
            {t('auth.login.railTagline')}
          </div>
        </div>
      }
      footer={<Trans k="auth.login.newSchool" nodes={{ link: <Link to="/register">{t('auth.createAccountLink')}</Link> }} />}
    >
      <form onSubmit={handleSubmit}>
        {location.state?.phoneVerified && !error ? <SuccessBanner message={t('auth.login.phoneVerified')} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {needsVerifying ? (
          <p style={{ marginTop: 0 }}>
            <Link to="/verify-otp">{t('auth.login.verifyPhoneLink')}</Link>
          </p>
        ) : null}
        <Field label={t('auth.emailLabel')} htmlFor="login-email">
          <TextField
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label={t('auth.passcodeLabel')}
          htmlFor="login-passcode"
          hint={t('auth.passcodeHint')}
          labelAction={
            <Link to="/forgot-passcode" className="ultm8-field__label-action">
              {t('auth.login.forgotPasscode')}
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
          {t('auth.logIn')}
        </Button>
      </form>
    </AuthCard>
  );
}
