import React, { useState } from 'react';
import { AuthCard, Button, ErrorBanner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { LegalAgreeCheckbox } from './LegalAgreeCheckbox';

/**
 * Decision 448 item 8: someone the School created (added manually, an
 * approved tablet sign-up, an import, a Guardian added by staff), or who
 * signed up before the "I agree" tick existed, ticks the Terms and Privacy
 * once, at their first sign-in. Shown in place of any signed-in page while
 * the token says `legalPending`; the API refuses everything else until then.
 * The new token the API returns opens the page they were going to.
 */
export function AcceptTermsPage() {
  const t = useT();
  const { setAccessToken, logout } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError(t('server.codes.legalAcceptanceRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await unwrap(apiClient.POST('/v1/auth/legal-acceptance', { body: { acceptTerms: true } }));
      setAccessToken(result.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title={t('legal.firstSignIn.title')} subtitle={t('legal.firstSignIn.body')}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <LegalAgreeCheckbox kind="account" checked={accepted} onChange={setAccepted} />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" fullWidth loading={submitting}>
            {t('legal.firstSignIn.submit')}
          </Button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Button type="button" variant="secondary" fullWidth onClick={() => void logout()}>
            {t('legal.firstSignIn.signOut')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
