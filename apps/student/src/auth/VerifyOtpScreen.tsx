import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, PhoneField, Screen, SuccessBanner, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { guessDefaultCountry } from '../lib/phoneCountry';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyOtp'>;

export function VerifyOtpScreen({ route, navigation }: Props) {
  const t = useT();
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleVerify() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await unwrap(apiClient.POST('/v1/auth/otp/verify', { body: { phone, code } }));
      navigation.navigate('Login');
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resending) return;
    setError(null);
    setResent(false);
    setResending(true);
    try {
      await unwrap(apiClient.POST('/v1/auth/otp/send', { body: { phone } }));
      setResent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.verifyOtp.resendFailed')));
    } finally {
      setResending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>{t('auth.verifyOtp.title')}</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          {t('auth.verifyOtp.intro')}
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        {resent ? <SuccessBanner message={t('auth.verifyOtp.resent')} /> : null}
        <Field label={t('auth.fields.phone')}>
          <PhoneField value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('auth.fields.verificationCode')}>
          <TextField keyboardType="number-pad" value={code} onChangeText={setCode} />
        </Field>
        <Button title={t('auth.verifyOtp.verify')} onPress={handleVerify} loading={submitting} />
        <Button title={t('auth.verifyOtp.resend')} variant="secondary" onPress={handleResend} loading={resending} />
      </Screen>
    </ScrollView>
  );
}
