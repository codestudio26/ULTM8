import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, Field, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { useSignWaiver } from './waiverQueries';

type Waiver = components['schemas']['WaiverResponseDto'];
type WaiverSignature = components['schemas']['WaiverSignatureResponseDto'];

/** One Waiver on WaiversScreen. `signature` is looked up by the parent (which
 * Signature belongs to which Waiver) rather than fetched here — a Student's own
 * signatures are a small, self-scoped list already needed once per screen, not
 * once per row.
 *
 * Typed name + typed signature text only — the confirmed baseline mechanism
 * (`SignWaiverDto`'s own header comment: "Neither field accepts drawn/canvas
 * signature data this phase"). A drawn-signature capture UI is a separate,
 * genuinely undesigned enhancement (Decision 74), not built here. */
export function WaiverRow({ waiver, signature }: { waiver: Waiver; signature: WaiverSignature | undefined }) {
  const [signing, setSigning] = useState(false);
  const [signerFullName, setSignerFullName] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const signWaiver = useSignWaiver();

  function handleSubmit() {
    if (signWaiver.isPending) return;
    signWaiver.mutate({ waiverId: waiver.id, signerFullName, signatureText });
  }

  // FOUND ON REVIEW: waiting on `signature` (the parent's prop, only updated once
  // invalidateQueries' refetch round-trips) left a window right after a successful
  // submit where this row still showed the form — the Student could tap "Submit
  // signature" again and hit the backend's unique-signature 409. Reading the
  // mutation's own returned data the instant it succeeds (same pattern already
  // fixed in MembershipPlanRow) closes that window with no round-trip wait.
  const effectiveSignature = signature ?? (signWaiver.isSuccess ? signWaiver.data : undefined);

  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontWeight: '600' }}>{waiver.title}</Text>
      <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }} numberOfLines={3}>
        {waiver.body}
      </Text>

      {effectiveSignature ? (
        <Text style={{ color: '#188038', fontSize: 13, marginTop: 6 }}>Signed {formatDate(effectiveSignature.signedDate)} ✓</Text>
      ) : signing ? (
        <View style={{ marginTop: 8 }}>
          <Field label="Full name">
            <TextField value={signerFullName} onChangeText={setSignerFullName} placeholder="Your full legal name" />
          </Field>
          <Field label="Signature" hint="Type your name again as your signature.">
            <TextField value={signatureText} onChangeText={setSignatureText} placeholder="Type your signature" />
          </Field>
          {signWaiver.isError ? (
            <InlineError message={getApiErrorMessage(signWaiver.error, 'Could not sign this waiver — please try again.')} />
          ) : null}
          <Button
            title="Submit signature"
            onPress={handleSubmit}
            loading={signWaiver.isPending}
            disabled={!signerFullName.trim() || !signatureText.trim()}
          />
        </View>
      ) : (
        <Button title="Sign" variant="secondary" onPress={() => setSigning(true)} />
      )}
    </View>
  );
}
