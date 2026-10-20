import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Button, ErrorBanner, Field, PasscodeField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAuth } from './AuthContext';
import { takeReturnTo } from './returnTo';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 1/230 — a server-generated temp passcode (Instructor "Add
 * Manually") must be replaced before any ordinary session exists. Reached
 * only from LoginPage's own must-change-passcode branch, carrying the
 * one-use `passcodeChangeToken` as router state — there's no other way in.
 *
 * The Authorization header is set explicitly, per-call, to this token rather
 * than left to apiClient's usual auth middleware: no normal session is
 * stored yet (that's the whole point of this page), so the middleware's own
 * `getAccessToken()` returns nothing and never overwrites this explicit
 * header — see packages/api-client's own authMiddleware.
 */
export function FirstLoginPasscodeChangePage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { passcodeChangeToken?: string } };
  const { setAccessToken } = useAuth();
  const passcodeChangeToken = location.state?.passcodeChangeToken;

  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!passcodeChangeToken) {
    navigate('/login', { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPasscode !== confirmPasscode) {
      setError(t('auth.newPasscodeMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await unwrap(
        apiClient.POST('/v1/auth/passcode-change/first-login', {
          headers: { Authorization: `Bearer ${passcodeChangeToken}` },
          body: { newPasscode },
        }),
      );
      // This endpoint always returns real tokens, never the mustChangePasscode
      // shape — LoginResponseDto's fields are all optional only because it's
      // shared with /auth/login's own two possible shapes (see that DTO's
      // header comment).
      setAccessToken(result.accessToken!);
      navigate(takeReturnTo() ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title={t('auth.firstLogin.title')} subtitle={t('auth.firstLogin.subtitle')}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.newPasscodeLabel')} htmlFor="first-login-newPasscode" hint={t('auth.passcodeHint')}>
          <PasscodeField
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={newPasscode}
            onChange={(e) => setNewPasscode(e.target.value)}
          />
        </Field>
        <Field label={t('auth.confirmNewPasscodeLabel')} htmlFor="first-login-confirmPasscode">
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
          {t('auth.firstLogin.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
