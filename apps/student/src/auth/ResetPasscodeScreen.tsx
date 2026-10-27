import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, PhoneField, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { guessDefaultCountry } from '../lib/phoneCountry';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPasscode'>;

export function ResetPasscodeScreen({ route, navigation }: Props) {
  const t = useT();
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [code, setCode] = useState('');
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
      await unwrap(apiClient.POST('/v1/auth/reset-password', { body: { phone, code, newPasscode } }));
      navigation.navigate('Login');
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>{t('auth.resetPasscode.title')}</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          {t('auth.resetPasscode.intro')}
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.fields.phone')}>
          <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('auth.fields.verificationCode')}>
          <TextField keyboardType="number-pad" value={code} onChangeText={setCode} />
        </Field>
        <Field label={t('auth.resetPasscode.newPasscode')} hint={t('auth.fields.sixDigits')}>
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={newPasscode} onChangeText={setNewPasscode} />
        </Field>
        <Field label={t('auth.resetPasscode.confirmNewPasscode')}>
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={confirmPasscode} onChangeText={setConfirmPasscode} />
        </Field>
        <Button title={t('auth.resetPasscode.submit')} onPress={handleSubmit} loading={submitting} />
      </Screen>
    </ScrollView>
  );
}
