import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useAuth } from './AuthContext';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ChoosePasscode'>;

/** First sign-in with the temporary passcode a School sent (a student the
 * owner added by hand, Decision 366): choose one's own 6-digit passcode, then
 * signed in. */
export function ChoosePasscodeScreen({ route }: Props) {
  const t = useT();
  const { completeFirstLogin } = useAuth();
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (newPasscode !== confirmPasscode) {
      setError(t('auth.resetPasscode.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await completeFirstLogin(route.params.passcodeChangeToken, newPasscode);
      // RootNavigator swaps to the app once signed in.
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>{t('auth.choosePasscode.title')}</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>{t('auth.choosePasscode.intro')}</Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.resetPasscode.newPasscode')} hint={t('auth.fields.sixDigits')}>
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={newPasscode} onChangeText={setNewPasscode} />
        </Field>
        <Field label={t('auth.resetPasscode.confirmNewPasscode')}>
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={confirmPasscode} onChangeText={setConfirmPasscode} />
        </Field>
        <Button title={t('auth.choosePasscode.submit')} onPress={handleSubmit} loading={submitting} />
      </Screen>
    </ScrollView>
  );
}
