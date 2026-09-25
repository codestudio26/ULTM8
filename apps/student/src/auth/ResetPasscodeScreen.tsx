import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPasscode'>;

export function ResetPasscodeScreen({ route, navigation }: Props) {
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
      setError('New passcode and confirmation must match.');
      return;
    }
    setSubmitting(true);
    try {
      await unwrap(apiClient.POST('/v1/auth/reset-password', { body: { phone, code, newPasscode } }));
      navigation.navigate('Login');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Something went wrong — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>Set a new passcode</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          Enter the code we sent, then choose a new 6-digit passcode.
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Phone" hint="E.164 format, e.g. +15551234567">
          <TextField keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        </Field>
        <Field label="Verification code">
          <TextField keyboardType="number-pad" value={code} onChangeText={setCode} />
        </Field>
        <Field label="New passcode" hint="6 digits">
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={newPasscode} onChangeText={setNewPasscode} />
        </Field>
        <Field label="Confirm new passcode">
          <TextField keyboardType="number-pad" secureTextEntry maxLength={6} value={confirmPasscode} onChangeText={setConfirmPasscode} />
        </Field>
        <Button title="Set new passcode" onPress={handleSubmit} loading={submitting} />
      </Screen>
    </ScrollView>
  );
}
