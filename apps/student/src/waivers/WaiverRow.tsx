import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import type { components } from '@ultm8/api-client';
import { Button, Field, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { useSignWaiver } from './waiverQueries';
import { useT } from '../i18n/I18nProvider';

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
 * native` is. */
/** `forStudentId`/`forName` (Decision 428, Student portal review M1): a
 * parent signs this waiver for their child. `childMaySign` (Decision 318
 * item 8): the child's School lets children of their age sign themselves, so
 * the parent can hand the phone over and the child signs instead. */
export function WaiverRow({
  waiver,
  signature,
  forStudentId,
  forName,
  childMaySign = false,
}: {
  waiver: Waiver;
  signature: Pick<WaiverSignature, 'signedDate'> | undefined;
  forStudentId?: string;
  forName?: string;
  childMaySign?: boolean;
}) {
  const t = useT();
  const [signing, setSigning] = useState(false);
  // Decision 427 (SP8): the whole waiver can be read; it is always shown in full while signing.
  const [expanded, setExpanded] = useState(false);
  const [signerFullName, setSignerFullName] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);
  const [byChild, setByChild] = useState(false);
  const childCanSign = !!forStudentId && childMaySign;
  const padRef = useRef<SignatureViewRef>(null);
  const signWaiver = useSignWaiver();

  function handleSubmit() {
    if (signWaiver.isPending) return;
    signWaiver.mutate({
      waiverId: waiver.id,
      signerFullName,
      signatureText,
      signatureImage: drawnSignature,
      waiverVersion: waiver.version,
      ...(forStudentId ? { studentId: forStudentId, signedByChild: childCanSign && byChild } : {}),
    });
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
      <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }} numberOfLines={expanded || signing ? undefined : 3}>
        {waiver.body}
      </Text>
      {signing ? null : (
        <Button
          title={expanded ? t('waivers.row.showLess') : t('waivers.row.readFull')}
          variant="secondary"
          onPress={() => setExpanded((e) => !e)}
        />
      )}

      {effectiveSignature ? (
        <Text style={{ color: '#188038', fontSize: 13, marginTop: 6 }}>
          {/* v1.2 backend backlog ("Waivers page", gap 2) — signedDate is now
              nullable on the DTO (an Unsigned "assignment" row has none yet),
              but `effectiveSignature` here is always either a row the parent
              already filtered to status === 'SIGNED' (WaiversScreen.tsx) or
              this screen's own just-succeeded sign() response — both cases
              sign() itself always stamps a real signedDate on, so the `?? ''`
              branch is unreachable in practice, not a silent "unknown date"
              UI state being accepted. */}
          {t('waivers.row.signed', { date: formatDate(effectiveSignature.signedDate ?? '') })}
        </Text>
      ) : signing ? (
        <View style={{ marginTop: 8 }}>
          {childCanSign ? (
            <View style={{ marginBottom: 6 }}>
              <Text style={{ fontWeight: '600', marginBottom: 4 }}>{t('waivers.row.whoSigns')}</Text>
              <Button title={t('waivers.row.parentSigns')} variant={byChild ? 'secondary' : 'primary'} onPress={() => setByChild(false)} />
              <Button title={t('waivers.row.childSigns', { name: forName ?? '' })} variant={byChild ? 'primary' : 'secondary'} onPress={() => setByChild(true)} />
            </View>
          ) : null}
          {forName ? (
            <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 6 }}>
              {childCanSign && byChild ? t('waivers.row.childSigning', { name: forName }) : t('waivers.row.signingFor', { name: forName })}
            </Text>
          ) : null}
          <Field label={t('waivers.row.fullName')}>
            <TextField value={signerFullName} onChangeText={setSignerFullName} placeholder={t('waivers.row.fullNamePlaceholder')} />
          </Field>
          <Field label={t('waivers.row.signature')} hint={t('waivers.row.signatureHint')}>
            <TextField value={signatureText} onChangeText={setSignatureText} placeholder={t('waivers.row.signaturePlaceholder')} />
          </Field>
          <Field label={t('waivers.row.drawnSignature')} hint={t('waivers.row.drawnSignatureHint')}>
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
            {drawnSignature ? <Button variant="secondary" title={t('waivers.row.clearSignature')} onPress={handleClearSignature} /> : null}
          </Field>
          {signWaiver.isError ? (
            <InlineError message={getApiErrorMessage(signWaiver.error, t('waivers.row.signError'))} />
          ) : null}
          <Button
            title={t('waivers.row.submit')}
            onPress={handleSubmit}
            loading={signWaiver.isPending}
            disabled={!signerFullName.trim() || !signatureText.trim()}
          />
          {/* Decision 427 (SP13): a way back out of the signing form. */}
          <Button title={t('waivers.row.cancel')} variant="secondary" onPress={() => setSigning(false)} />
        </View>
      ) : (
        <Button title={t('waivers.row.sign')} variant="secondary" onPress={() => setSigning(true)} />
      )}
    </View>
  );
}
