import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useAuth } from './AuthContext';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const t = useT();
  const { login, pendingSchoolPick, clearPendingSchoolPick } = useAuth();
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await login(email, passcode);
      // A temporary passcode from the School: choose one's own first.
      if (outcome) {
        navigation.navigate('ChoosePasscode', { passcodeChangeToken: outcome.passcodeChangeToken });
        return;
      }
      // No navigation.reset() needed here — RootNavigator swaps the whole stack to
      // AppNavigator once useAuth().accessToken is set (see RootNavigator.tsx).
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading, marginBottom: spacing[1] }}>{t('auth.login.title')}</Text>
        <Text style={{ fontSize: fontSize.footnote, color: theme.textSecondary, marginBottom: spacing[6] }}>
          {t('auth.login.intro')}
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.fields.email')}>
          <TextField
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
        </Field>
        <Field label={t('auth.fields.passcode')} hint={t('auth.fields.sixDigits')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={passcode}
            onChangeText={setPasscode}
          />
        </Field>
        <Button title={t('auth.login.submit')} onPress={handleSubmit} loading={submitting} />
        <Button title={t('auth.login.createAccount')} variant="secondary" onPress={() => navigation.navigate('Register')} />
        <Button
          title={t('auth.login.forgotPasscode')}
          variant="secondary"
          onPress={() => navigation.navigate('ForgotPasscode')}
        />
        {/* Decision 427 (SP12): the School picked on first launch can be changed before signing in. */}
        {pendingSchoolPick ? (
          <>
            <Text style={{ fontSize: fontSize.footnote, color: theme.textSecondary, marginTop: spacing[4], textAlign: 'center' }}>
              {t('auth.login.pickedSchool', { school: pendingSchoolPick.name })}
            </Text>
            <Button title={t('auth.login.changeSchool')} variant="secondary" onPress={clearPendingSchoolPick} />
          </>
        ) : null}
      </Screen>
    </ScrollView>
  );
}
