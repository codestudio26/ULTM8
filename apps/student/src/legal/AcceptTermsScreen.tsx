import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { registerForPushNotificationsAsync } from '../notifications/pushRegistration';
import { useT } from '../i18n/I18nProvider';
import { fontSize, minTouchTarget, spacing } from '../theme/tokens';
import { LegalLinks } from './LegalLinks';

/**
 * Decision 448 item 8: someone the School created (added manually, an
 * approved tablet sign-up, an import, a Guardian added by staff), or who
 * signed up before the "I agree" tick existed, ticks the Terms and Privacy
 * once, at their first sign-in. RootNavigator shows this in place of the app
 * while the token says `legalPending`; the API refuses everything else until
 * then. The new token the API returns opens the app.
 */
export function AcceptTermsScreen() {
  const t = useT();
  const { applyAccessToken, logout } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (!accepted) {
      setError(t('server.codes.legalAcceptanceRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await unwrap(apiClient.POST('/v1/auth/legal-acceptance', { body: { acceptTerms: true } }));
      await applyAccessToken(result.accessToken);
      // Sign-in's own registration was refused while the step was open.
      void registerForPushNotificationsAsync();
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>
          {t('legal.firstSignIn.title')}
        </Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>{t('legal.firstSignIn.body')}</Text>
        {error ? <ErrorBanner message={error} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: minTouchTarget }}>
          <Switch value={accepted} onValueChange={setAccepted} accessibilityLabel={t('legal.agree.account')} />
          <Text style={{ flex: 1, fontSize: fontSize.footnote }}>{t('legal.agree.account')}</Text>
        </View>
        <LegalLinks slugs={['terms-and-conditions', 'privacy-statement']} />
        <Button title={t('legal.firstSignIn.submit')} onPress={handleSubmit} loading={submitting} />
        <Button title={t('legal.firstSignIn.signOut')} variant="secondary" onPress={() => void logout()} />
      </Screen>
    </ScrollView>
  );
}
