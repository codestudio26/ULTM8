import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useVerifyStepUp } from './stepUpQueries';

/**
 * Decision 236 — re-enters the caller's own passcode to confirm a sensitive
 * action already in progress (today: Guardian BASELINE consent withdrawal).
 * Inline, not a full Screen — meant to render in place of/alongside whatever
 * destructive-action confirmation already asked the user to proceed (mirrors
 * ConsentTierRow's own inline-panel style, not ResetPasscodeScreen's full-page
 * one), since this is one more step in an already-open confirmation, not a
 * separate navigation destination.
 */
export function StepUpPrompt({
  onVerified,
  onCancel,
}: {
  onVerified: (stepUpToken: string) => void;
  onCancel: () => void;
}) {
  const [passcode, setPasscode] = useState('');
  const verify = useVerifyStepUp();

  function handleSubmit() {
    if (verify.isPending || passcode.length !== 6) return;
    verify.mutate(passcode, {
      onSuccess: (data) => onVerified(data.stepUpToken),
    });
  }

  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ fontSize: 13, marginBottom: 8 }}>Re-enter your passcode to confirm.</Text>
      {verify.isError ? (
        <InlineError message={getApiErrorMessage(verify.error, 'Incorrect passcode — please try again.')} />
      ) : null}
      <TextField
        testID="step-up-passcode-input"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        value={passcode}
        onChangeText={setPasscode}
      />
      <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Confirm"
            variant="destructive"
            onPress={handleSubmit}
            loading={verify.isPending}
            disabled={passcode.length !== 6}
          />
        </View>
      </View>
    </View>
  );
}
