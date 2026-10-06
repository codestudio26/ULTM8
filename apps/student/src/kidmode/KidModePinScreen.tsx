import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Field, InlineError, Screen, TextField } from '../components/ui';
import type { AppStackParamList } from '../navigation/types';
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
      setError(`PIN must be ${PIN_LENGTH} digits.`);
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.');
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
      setError('Incorrect PIN.');
      setPin('');
      return;
    }
    navigation.replace('KidModeBooking');
  }

  if (existingPin === null) {
    return (
      <Screen>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Set a Kid Mode PIN</Text>
        <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 16 }}>
          You'll enter this each time before handing the device over. It's just a handoff check — not a password.
        </Text>
        <Field label="New PIN">
          <TextField value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={PIN_LENGTH} />
        </Field>
        <Field label="Confirm PIN">
          <TextField
            value={confirmPin}
            onChangeText={setConfirmPin}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
          />
        </Field>
        {error ? <InlineError message={error} /> : null}
        <Button title="Set PIN" onPress={handleSetPin} loading={saving} disabled={!pin || !confirmPin} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>Enter Kid Mode PIN</Text>
      <Field label="PIN">
        <TextField value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={PIN_LENGTH} autoFocus />
      </Field>
      {error ? <InlineError message={error} /> : null}
      <Button title="Continue" onPress={handleConfirmPin} disabled={pin.length !== PIN_LENGTH} />
    </Screen>
  );
}
