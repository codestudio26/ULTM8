import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import { useMedicalInfoShared, useWithdrawMedicalInfo, type MedicalInfoShared } from './medicalInfoQueries';

/**
 * Decision 419 item 1: "The member (the Guardian for a child) can see that
 * medical information is shared with the School and withdraw consent at any
 * time in the app. Withdrawing deletes the stored medical information at
 * once."
 *
 * One line per School that holds some ("Medical information: shared with
 * {School}") with the date consent was given and a Withdraw button, which
 * asks for confirmation first (an inline panel: Alert.alert does nothing on
 * the web build, see ConsentTierRow). Shows nothing when no School holds any,
 * or when the person can't manage it (a child: the API refuses with 403).
 * Used on My Profile (oneself) and on a Guardian's child's screen.
 */
export function MedicalInfoSharing({ studentId }: { studentId: string | undefined }) {
  const t = useT();
  const shared = useMedicalInfoShared(studentId);

  if (!studentId || shared.isLoading) return null;
  if (shared.isError && !shared.data) {
    if (shared.error instanceof ApiError && shared.error.status === 403) return null;
    return <InlineError message={getApiErrorMessage(shared.error, t('profile.medical.loadFailed'))} />;
  }
  const items = shared.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View style={{ marginTop: spacing[4], marginBottom: spacing[4] }}>
      <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading, color: theme.textPrimary }}>{t('profile.medical.title')}</Text>
      {items.map((item) => (
        <SharedRow key={item.schoolId} studentId={studentId} item={item} />
      ))}
    </View>
  );
}

function SharedRow({ studentId, item }: { studentId: string; item: MedicalInfoShared }) {
  const t = useT();
  const withdraw = useWithdrawMedicalInfo(studentId);
  const [confirming, setConfirming] = useState(false);

  function confirm() {
    if (withdraw.isPending) return;
    setConfirming(false);
    withdraw.mutate(item.schoolId);
  }

  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ color: theme.textPrimary }}>{t('profile.medical.sharedWith', { school: item.schoolName })}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>
        {t('profile.medical.consentedOn', { date: formatDate(item.consentedAt) })}
      </Text>
      {item.awaitingAcceptance ? (
        <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>{t('profile.medical.awaiting')}</Text>
      ) : null}
      {withdraw.isError ? <InlineError message={getApiErrorMessage(withdraw.error, t('profile.medical.withdrawFailed'))} /> : null}
      {confirming ? (
        <View style={{ marginTop: spacing[2] }}>
          <Text style={{ color: theme.textDanger, fontSize: fontSize.footnote }}>{t('profile.medical.confirm', { school: item.schoolName })}</Text>
          <View style={{ flexDirection: 'row', marginTop: spacing[2], gap: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button title={t('profile.medical.cancel')} variant="secondary" onPress={() => setConfirming(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('profile.medical.confirmWithdraw')} variant="destructive" onPress={confirm} loading={withdraw.isPending} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ marginTop: spacing[2] }}>
          <Button
            title={t('profile.medical.withdraw')}
            variant="secondary"
            onPress={() => setConfirming(true)}
            loading={withdraw.isPending}
          />
        </View>
      )}
    </View>
  );
}
