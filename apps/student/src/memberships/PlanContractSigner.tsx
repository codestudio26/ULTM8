import React, { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { Button, Field, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { useT } from '../i18n/I18nProvider';
import { usePlanContract, useSignPlanContract } from './planContractQueries';

// Same pad styling as the waiver signing form (WaiverRow).
const SIGNATURE_PAD_WEB_STYLE = `.m-signature-pad--footer { display: none; margin: 0; } .m-signature-pad--body { border: none; } body,html { background-color: #fff; }`;

/**
 * Decision 316 item 6: the plan's contract, read in full and signed before
 * buying, like a waiver: full name, typed signature and an optional drawn
 * one. A parent signs for their child (`forStudentId`). On success the
 * signature's id goes to `onSigned`, which buys the plan with it.
 */
export function PlanContractSigner({
  planId,
  forStudentId,
  onSigned,
  onCancel,
}: {
  planId: string;
  forStudentId?: string;
  onSigned: (contractSignatureId: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const contract = usePlanContract(planId, forStudentId);
  const signContract = useSignPlanContract();
  const [signerFullName, setSignerFullName] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null);
  const padRef = useRef<SignatureViewRef>(null);

  if (contract.isLoading) return <ActivityIndicator />;
  if (contract.isError || !contract.data) {
    return (
      <View style={{ marginTop: 8 }}>
        <InlineError message={getApiErrorMessage(contract.error, t('memberships.contract.loadError'))} />
        <Button title={t('waivers.row.cancel')} variant="secondary" onPress={onCancel} />
      </View>
    );
  }
  const c = contract.data;

  function handleSubmit() {
    if (signContract.isPending) return;
    signContract.mutate(
      {
        planId,
        signerFullName,
        signatureText,
        signatureImage: drawnSignature,
        contractVersion: c.version,
        ...(forStudentId ? { studentId: forStudentId } : {}),
      },
      { onSuccess: (signature) => onSigned(signature.id) },
    );
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontWeight: '600' }}>{t('memberships.contract.title')}</Text>
      <Text style={{ color: '#5F6368', fontSize: 12, marginBottom: 6 }}>
        {forStudentId ? t('memberships.contract.guardianSigns') : t('memberships.contract.intro')}
      </Text>
      <Text style={{ fontSize: 13 }}>{c.body}</Text>
      {c.minimumTermMonths != null ? (
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600' }}>
            {t('memberships.contract.termsLine', { months: c.minimumTermMonths, amount: formatMoney(c.earlyExitFee ?? 0, c.currency) })}
          </Text>
          {c.earlyExitFee ? <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('memberships.contract.taxNote')}</Text> : null}
        </View>
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
        {drawnSignature ? (
          <Button
            variant="secondary"
            title={t('waivers.row.clearSignature')}
            onPress={() => {
              padRef.current?.clearSignature();
              setDrawnSignature(null);
            }}
          />
        ) : null}
      </Field>
      {signContract.isError ? <InlineError message={getApiErrorMessage(signContract.error, t('memberships.contract.signError'))} /> : null}
      <Button
        title={t('memberships.contract.signAndContinue')}
        onPress={handleSubmit}
        loading={signContract.isPending}
        disabled={!signerFullName.trim() || !signatureText.trim()}
      />
      <Button title={t('waivers.row.cancel')} variant="secondary" onPress={onCancel} />
    </View>
  );
}
