import React, { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner, Field, PhoneField, Screen, TextField } from '../components/ui';
import { OneNameSwitch } from '../components/OneNameSwitch';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { guessDefaultCountry } from '../lib/phoneCountry';
import type { AuthStackParamList } from '../navigation/types';
import { LegalLinks } from '../legal/LegalLinks';
import { fontSize, minTouchTarget, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/** Fields match RegisterDto exactly (apps/api/src/auth/dto/register.dto.ts), same as
 * apps/school-portal/src/auth/RegisterPage.tsx — nothing added or removed. `username`
 * is called out on the DTO as "Mobile app only", so unlike school-portal it's a
 * top-level field here rather than tucked into an "optional details" section. */
export function RegisterScreen({ navigation }: Props) {
  const t = useT();
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
  // Decision 434 (TXT-8): "I have only one name" sends an empty surname.
  const [oneName, setOneName] = useState(false);
  // Decision 440 (C1): the Terms and Privacy tick, sent as acceptTerms.
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (form.passcode !== form.passcodeConfirm) {
      setError(t('auth.register.passcodeMismatch'));
      return;
    }
    if (!acceptTerms) {
      setError(t('server.codes.termsNotAccepted'));
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
            surname: oneName ? '' : form.surname,
            ...(oneName ? { hasOnlyOneName: true } : {}),
            username: form.username || undefined,
            passcode: form.passcode,
            passcodeConfirm: form.passcodeConfirm,
            dateOfBirth: form.dateOfBirth,
            acceptTerms,
          },
        }),
      );
      // Registration sends the OTP itself (AuthService.register()) — no separate send call needed.
      navigation.navigate('VerifyOtp', { phone: form.phone });
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>{t('auth.register.title')}</Text>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 20 }}>
          {t('auth.register.intro')}
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.fields.email')}>
          <TextField
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(v) => set('email', v)}
          />
        </Field>
        <Field label={t('auth.fields.phone')}>
          <PhoneField value={form.phone} onChange={(v) => set('phone', v)} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('auth.register.firstName')}>
          <TextField value={form.firstName} onChangeText={(v) => set('firstName', v)} />
        </Field>
        <Field label={t('auth.register.surname')}>
          <TextField value={oneName ? '' : form.surname} editable={!oneName} onChangeText={(v) => set('surname', v)} />
        </Field>
        <OneNameSwitch value={oneName} onChange={setOneName} label={t('auth.register.hasOnlyOneName')} />
        <Field label={t('auth.register.username')} hint={t('auth.register.optional')}>
          <TextField autoCapitalize="none" value={form.username} onChangeText={(v) => set('username', v)} />
        </Field>
        <Field label={t('auth.fields.passcode')} hint={t('auth.register.passcodeHint')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={form.passcode}
            onChangeText={(v) => set('passcode', v)}
          />
        </Field>
        <Field label={t('auth.register.confirmPasscode')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={form.passcodeConfirm}
            onChangeText={(v) => set('passcodeConfirm', v)}
          />
        </Field>
        <Field label={t('auth.register.dateOfBirth')} hint={t('auth.register.dateFormat')}>
          <TextField
            placeholder={t('auth.register.dateFormat')}
            value={form.dateOfBirth}
            onChangeText={(v) => set('dateOfBirth', v)}
          />
        </Field>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: minTouchTarget }}>
          <Switch value={acceptTerms} onValueChange={setAcceptTerms} accessibilityLabel={t('legal.agree.account')} />
          <Text style={{ flex: 1, fontSize: fontSize.footnote }}>{t('legal.agree.account')}</Text>
        </View>
        <LegalLinks slugs={['terms-and-conditions', 'privacy-statement']} />
        <Button title={t('auth.register.submit')} onPress={handleSubmit} loading={submitting} />
        <Button title={t('auth.register.haveAccount')} variant="secondary" onPress={() => navigation.navigate('Login')} />
      </Screen>
    </ScrollView>
  );
}
