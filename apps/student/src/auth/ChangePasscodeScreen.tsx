import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useAuth } from './AuthContext';

/** Decision 428 (Student portal review M3, Decision 375's web version) —
 * change one's own passcode by giving the current one. Other devices are
 * signed out; this one stays signed in. */
export function ChangePasscodeScreen() {
  const t = useT();
  const { changePasscode } = useAuth();
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const sixDigits = (v: string) => /^\d{6}$/.test(v);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    if (newPasscode !== confirmPasscode) {
      setError(t('auth.resetPasscode.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await changePasscode(currentPasscode, newPasscode);
      setDone(true);
      setCurrentPasscode('');
      setNewPasscode('');
      setConfirmPasscode('');
    } catch (err) {
      setError(getApiErrorMessage(err, t('auth.errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: 14, color: '#5F6368', marginBottom: 16 }}>{t('auth.changePasscode.intro')}</Text>
        {error ? <ErrorBanner message={error} /> : null}
        {done ? <Text style={{ color: '#188038', marginBottom: 12 }}>{t('auth.changePasscode.done')}</Text> : null}
        <Field label={t('auth.changePasscode.current')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={currentPasscode}
            onChangeText={setCurrentPasscode}
            accessibilityLabel={t('auth.changePasscode.current')}
          />
        </Field>
        <Field label={t('auth.resetPasscode.newPasscode')} hint={t('auth.fields.sixDigits')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={newPasscode}
            onChangeText={setNewPasscode}
            accessibilityLabel={t('auth.resetPasscode.newPasscode')}
          />
        </Field>
        <Field label={t('auth.resetPasscode.confirmNewPasscode')}>
          <TextField
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            value={confirmPasscode}
            onChangeText={setConfirmPasscode}
            accessibilityLabel={t('auth.resetPasscode.confirmNewPasscode')}
          />
        </Field>
        <Button
          title={t('auth.changePasscode.submit')}
          onPress={handleSubmit}
          loading={submitting}
          disabled={!sixDigits(currentPasscode) || !sixDigits(newPasscode) || !sixDigits(confirmPasscode)}
        />
      </Screen>
    </ScrollView>
  );
}
