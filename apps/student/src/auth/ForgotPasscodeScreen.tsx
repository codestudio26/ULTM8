import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPasscode'>;

export function ForgotPasscodeScreen({ navigation }: Props) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Always responds success regardless of whether the phone is registered
      // (AuthService.requestPasscodeReset — account-enumeration hygiene), so this
      // always proceeds to the reset screen rather than branching on the result.
      await unwrap(apiClient.POST('/v1/auth/forgot-password', { body: { phone } }));
      navigation.navigate('ResetPasscode', { phone });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Something went wrong — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>Reset your passcode</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          We'll text a verification code to your phone.
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Phone" hint="E.164 format, e.g. +15551234567">
          <TextField keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </Field>
        <Button title="Send code" onPress={handleSubmit} loading={submitting} />
        <Button title="Back to log in" variant="secondary" onPress={() => navigation.navigate('Login')} />
      </Screen>
    </ScrollView>
  );
}
