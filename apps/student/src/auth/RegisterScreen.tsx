import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/** Fields match RegisterDto exactly (apps/api/src/auth/dto/register.dto.ts), same as
 * apps/school-portal/src/auth/RegisterPage.tsx — nothing added or removed. `username`
 * is called out on the DTO as "Mobile app only", so unlike school-portal it's a
 * top-level field here rather than tucked into an "optional details" section. */
export function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState({
    email: '',
    phone: '',
    firstName: '',
    surname: '',
    username: '',
    passcode: '',
    passcodeConfirm: '',
    dateOfBirth: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (form.passcode !== form.passcodeConfirm) {
      setError('Passcode and confirmation must match.');
      return;
    }
    setSubmitting(true);
    try {
      await unwrap(
        apiClient.POST('/v1/auth/register', {
          body: {
            email: form.email,
            phone: form.phone,
            firstName: form.firstName,
            surname: form.surname,
            username: form.username || undefined,
            passcode: form.passcode,
            passcodeConfirm: form.passcodeConfirm,
            dateOfBirth: form.dateOfBirth,
          },
        }),
      );
      // Registration sends the OTP itself (AuthService.register()) — no separate send call needed.
      navigation.navigate('VerifyOtp', { phone: form.phone });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Something went wrong — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>Create your account</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          Register, then verify your phone to log in.
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email">
          <TextField
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(v) => set('email', v)}
          />
        </Field>
        <Field label="Phone" hint="E.164 format, e.g. +15551234567">
          <TextField keyboardType="phone-pad" value={form.phone} onChangeText={(v) => set('phone', v)} />
        </Field>
        <Field label="First name">
          <TextField value={form.firstName} onChangeText={(v) => set('firstName', v)} />
        </Field>
        <Field label="Surname">
          <TextField value={form.surname} onChangeText={(v) => set('surname', v)} />
        </Field>
        <Field label="Username" hint="Optional">
          <TextField autoCapitalize="none" value={form.username} onChangeText={(v) => set('username', v)} />
        </Field>
        <Field label="Passcode" hint="6 digits — this is your entire login credential">
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={form.passcode}
            onChangeText={(v) => set('passcode', v)}
          />
        </Field>
        <Field label="Confirm passcode">
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={form.passcodeConfirm}
            onChangeText={(v) => set('passcodeConfirm', v)}
          />
        </Field>
        <Field label="Date of birth" hint="YYYY-MM-DD">
          <TextField
            placeholder="YYYY-MM-DD"
            value={form.dateOfBirth}
            onChangeText={(v) => set('dateOfBirth', v)}
          />
        </Field>
        <Button title="Create account" onPress={handleSubmit} loading={submitting} />
        <Button title="Already have an account? Log in" variant="secondary" onPress={() => navigation.navigate('Login')} />
      </Screen>
    </ScrollView>
  );
}
