import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, Screen, SuccessBanner, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'VerifyOtp'>;

export function VerifyOtpScreen({ route, navigation }: Props) {
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
      setError(getApiErrorMessage(err, 'Something went wrong — please try again.'));
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
      setError(getApiErrorMessage(err, 'Could not resend the code.'));
    } finally {
      setResending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>Verify your phone</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          Enter the code we sent to complete registration.
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        {resent ? <SuccessBanner message="Code resent." /> : null}
        <Field label="Phone" hint="E.164 format, e.g. +15551234567">
          <TextField keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </Field>
        <Field label="Verification code">
          <TextField keyboardType="number-pad" value={code} onChangeText={setCode} />
        </Field>
        <Button title="Verify" onPress={handleVerify} loading={submitting} />
        <Button title="Resend code" variant="secondary" onPress={handleResend} loading={resending} />
      </Screen>
    </ScrollView>
  );
}
