import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useAuth } from './AuthContext';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await login(email, passcode);
      // No navigation.reset() needed here — RootNavigator swaps the whole stack to
      // AppNavigator once useAuth().accessToken is set (see RootNavigator.tsx).
    } catch (err) {
      setError(getApiErrorMessage(err, 'Something went wrong — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>Log in</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          Email and your 6-digit passcode — that's your whole login (no separate password).
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email">
          <TextField
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
        </Field>
        <Field label="Passcode" hint="6 digits">
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={passcode}
            onChangeText={setPasscode}
          />
        </Field>
        <Button title="Log in" onPress={handleSubmit} loading={submitting} />
        <Button title="Create an account" variant="secondary" onPress={() => navigation.navigate('Register')} />
        <Button
          title="Forgot your passcode?"
          variant="secondary"
          onPress={() => navigation.navigate('ForgotPasscode')}
        />
      </Screen>
    </ScrollView>
  );
}
