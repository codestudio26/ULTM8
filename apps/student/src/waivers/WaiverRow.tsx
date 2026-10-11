import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import type { components } from '@ultm8/api-client';
import { Button, Field, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { useSignWaiver } from './waiverQueries';

type Waiver = components['schemas']['WaiverResponseDto'];
type WaiverSignature = components['schemas']['WaiverSignatureResponseDto'];

// Hides the signature-pad's own built-in Clear/Save footer buttons — capture is
// driven by this screen's own "Clear signature" button and read on submit
// instead, so there's only one way to trigger each action, not two competing
// ones.
const SIGNATURE_PAD_WEB_STYLE = `.m-signature-pad--footer { display: none; margin: 0; } .m-signature-pad--body { border: none; } body,html { background-color: #fff; }`;

/** One Waiver on WaiversScreen. `signature` is looked up by the parent (which
 * Signature belongs to which Waiver) rather than fetched here — a Student's own
 * signatures are a small, self-scoped list already needed once per screen, not
 * once per row.
 *
 * Typed full name + typed signature text (the confirmed baseline, still
 * required) plus an OPTIONAL drawn signature (Phase 34/37's real shipped
 * mechanism — a presigned-upload-URL dance against R2, see
 * `waiverQueries.ts`'s `uploadDrawnSignature`). `react-native-signature-
 * canvas` renders an HTML5 canvas inside a WebView and flattens strokes to a
 * PNG entirely in the WebView's own JS (`toDataURL()`); no native image-
 * capture module is needed, so — like `expo-camera` was for the (now
 * superseded) QR check-in slice — this stays Expo Go-compatible: its only
 * dependency, `react-native-webview`, ships as an Expo Go "works out of the
 * box" package, not a custom native module the way `@stripe/stripe-react-
 * native` is. Guardian-on-behalf-of signing (the real DTO's optional
 * `studentId`) stays out of scope here — Student self-signing only. */
export function WaiverRow({ waiver, signature }: { waiver: Waiver; signature: WaiverSignature | undefined }) {
  const [signing, setSigning] = useState(false);
  const [signerFullName, setSignerFullName] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);
  const padRef = useRef<SignatureViewRef>(null);
  const signWaiver = useSignWaiver();

  function handleSubmit() {
    if (signWaiver.isPending) return;
    signWaiver.mutate({ waiverId: waiver.id, signerFullName, signatureText, signatureImage: drawnSignature });
  }

  function handleClearSignature() {
    padRef.current?.clearSignature();
    setDrawnSignature(null);
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
          <Field label="Drawn signature (optional)" hint="Sign with your finger or stylus — not required.">
            <View style={{ height: 180, borderWidth: 1, borderColor: '#EEE', borderRadius: 8, overflow: 'hidden' }}>
              <SignatureScreen
                ref={padRef}
                onOK={setDrawnSignature}
                onEmpty={() => setDrawnSignature(null)}
                onEnd={() => padRef.current?.readSignature()}
                autoClear={false}
                descriptionText=""
                webStyle={SIGNATURE_PAD_WEB_STYLE}
              />
            </View>
            {drawnSignature ? <Button variant="secondary" title="Clear signature" onPress={handleClearSignature} /> : null}
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
