import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Field, InlineError, Screen, TextField } from '../components/ui';
import type { AppStackParamList } from '../navigation/types';
import { useT } from '../i18n/I18nProvider';
import { getKidModePin, setKidModePin } from './kidModePinStore';

type Props = NativeStackScreenProps<AppStackParamList, 'KidModePin'>;

const PIN_LENGTH = 4;

/** Decision 123 — the device-handoff gate before Kid Mode's booking screen.
 * First visit on this device: set a PIN. Every visit after: confirm it. See
 * kidModePinStore.ts's own header comment for why this check is entirely
 * local — nothing here is sent to the backend, and getting it wrong only ever
 * costs a retry, never a security consequence (the real boundary is the
 * scoped Kid-Mode token minted once this screen passes). */
export function KidModePinScreen({ navigation }: Props) {
  const t = useT();
  const [loadingPin, setLoadingPin] = useState(true);
  const [existingPin, setExistingPin] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getKidModePin()
      .then(setExistingPin)
      .finally(() => setLoadingPin(false));
  }, []);

  if (loadingPin) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  async function handleSetPin() {
    setError(null);
    if (pin.length !== PIN_LENGTH) {
      setError(t('kidmode.pin.tooShort', { count: PIN_LENGTH }));
      return;
    }
    if (pin !== confirmPin) {
      setError(t('kidmode.pin.mismatch'));
      return;
    }
    setSaving(true);
    await setKidModePin(pin);
    setSaving(false);
    navigation.replace('KidModeBooking');
  }

  function handleConfirmPin() {
    setError(null);
    if (pin !== existingPin) {
      setError(t('kidmode.pin.incorrect'));
      setPin('');
      return;
    }
    navigation.replace('KidModeBooking');
  }

  if (existingPin === null) {
    return (
      <Screen>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>{t('kidmode.pin.setTitle')}</Text>
        <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 16 }}>{t('kidmode.pin.setIntro')}</Text>
        <Field label={t('kidmode.pin.newPin')}>
          <TextField value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={PIN_LENGTH} />
        </Field>
        <Field label={t('kidmode.pin.confirmPin')}>
          <TextField
            value={confirmPin}
            onChangeText={setConfirmPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
          />
        </Field>
        {error ? <InlineError message={error} /> : null}
        <Button title={t('kidmode.pin.setPin')} onPress={handleSetPin} loading={saving} disabled={!pin || !confirmPin} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>{t('kidmode.pin.enterTitle')}</Text>
      <Field label={t('kidmode.pin.pin')}>
        <TextField value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={PIN_LENGTH} autoFocus />
      </Field>
      {error ? <InlineError message={error} /> : null}
      <Button title={t('kidmode.pin.continue')} onPress={handleConfirmPin} disabled={pin.length !== PIN_LENGTH} />
    </Screen>
  );
}
