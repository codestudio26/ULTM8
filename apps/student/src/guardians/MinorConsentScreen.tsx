import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { ConsentTierRow } from './ConsentTierRow';
import { LegalLinks } from '../legal/LegalLinks';
import { BookingDelegationRow } from './BookingDelegationRow';
import { MedicalInfoSharing } from '../profile/MedicalInfoSharing';
import { useChildConsent, useMyConsentRecords, useMyMinors, useRemoveMe } from './guardianQueries';
import { formatDateOnly } from '../lib/formatDate';
import { useMyBookingDelegations } from './bookingDelegationQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MinorConsent'>;

/** CANDIDATE UI — see ConsentTierRow.tsx's own header comment. Both tiers always
 * render, in a fixed order (`ConsentTier` has exactly two confirmed values,
 * BASELINE/CAMERA — SKILL.md §14), regardless of whether either has ever been
 * granted. */
export function MinorConsentScreen({ route, navigation }: Props) {
  const t = useT();
  const { studentId, name } = route.params;
  const consent = useMyConsentRecords();
  const delegations = useMyBookingDelegations();
  // Decision 430 item 9: each parent sees the others' consent, read-only.
  const childConsent = useChildConsent(studentId);
  // Decision 430 item 7: nothing to give or withdraw for a child who is 18.
  const isAdult = !!useMyMinors().data?.items.find((m) => m.studentId === studentId)?.isAdult;
  const removeMe = useRemoveMe();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Gated on BOTH queries settling, not just consent's own — same discipline
  // Slice 6a's own review fixed for Waivers/signatures (a screen gating on only
  // one of two related queries can flash a wrong initial state for the other).
  if (consent.isLoading || delegations.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  // FOUND ON REVIEW (ConsentTierRow's own precedent): checking `isError` before
  // `data` would replace already-loaded status with a full-screen error the
  // moment any background refetch failed. Only block when there's genuinely
  // nothing cached for either query.
  if ((consent.isError && !consent.data) || (delegations.isError && !delegations.data)) {
    return (
      <Screen>
        <ErrorBanner
          message={getApiErrorMessage(consent.error ?? delegations.error, t('guardians.minorConsent.loadError'))}
        />
      </Screen>
    );
  }

  const activeByTier = new Map(
    (consent.data?.items ?? []).filter((r) => r.studentId === studentId && r.status === 'ACTIVE').map((r) => [r.tier, r]),
  );
  const activeDelegation = (delegations.data?.items ?? []).find((d) => d.studentId === studentId && d.status === 'ACTIVE');

  return (
    <Screen>
      <ScrollView>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>{name}</Text>
        {isAdult ? (
          <Text style={{ color: '#5F6368', marginBottom: 12 }}>{t('guardians.minorConsent.adult', { name })}</Text>
        ) : (
          <>
            <ConsentTierRow studentId={studentId} tier="BASELINE" record={activeByTier.get('BASELINE')} />
            <ConsentTierRow studentId={studentId} tier="CAMERA" record={activeByTier.get('CAMERA')} />
            <LegalLinks slugs={['children-notice']} />
            <BookingDelegationRow studentId={studentId} delegation={activeDelegation} />
          </>
        )}
        {(childConsent.data?.guardians ?? []).filter((g) => !g.isMe).length > 0 ? (
          <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
            <Text style={{ fontWeight: '600' }}>{t('guardians.minorConsent.othersTitle')}</Text>
            {(childConsent.data?.guardians ?? [])
              .filter((g) => !g.isMe)
              .map((g) => {
                const baseline = g.records.find((r) => r.tier === 'BASELINE');
                const status = !baseline
                  ? t('guardians.minorConsent.otherNone')
                  : baseline.status === 'ACTIVE'
                    ? t('guardians.minorConsent.otherGiven', { date: formatDateOnly(baseline.consentedAt) })
                    : t('guardians.minorConsent.otherWithdrawn', { date: formatDateOnly(baseline.withdrawnAt ?? baseline.consentedAt) });
                return (
                  <Text key={g.guardianId} style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>
                    {g.name}: {status}
                  </Text>
                );
              })}
          </View>
        ) : null}
        {/* Decision 419 item 1: the Guardian sees and withdraws their child's medical information sharing. */}
        <MedicalInfoSharing studentId={studentId} />
        {/* Decision 430 item 8: "Remove me" — never the last parent of an enrolled child. */}
        <View style={{ paddingVertical: 14 }}>
          {removeMe.isError ? <ErrorBanner message={getApiErrorMessage(removeMe.error, t('guardians.minorConsent.removeFailed'))} /> : null}
          {confirmingRemove ? (
            <>
              <Text style={{ marginBottom: 8 }}>{t('guardians.minorConsent.removeConfirm', { name })}</Text>
              <Button
                title={t('guardians.minorConsent.removeMe')}
                variant="destructive"
                loading={removeMe.isPending}
                onPress={() => removeMe.mutate(studentId, { onSuccess: () => navigation.goBack() })}
              />
              <Button title={t('guardians.minorConsent.keep')} variant="secondary" disabled={removeMe.isPending} onPress={() => setConfirmingRemove(false)} />
            </>
          ) : (
            <Button title={t('guardians.minorConsent.removeMe')} variant="secondary" onPress={() => setConfirmingRemove(true)} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
