import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { ConsentTierRow } from './ConsentTierRow';
import { policyVersionOf, useMyConsentEvents, useMyConsentRecords, useMyMinors, usePrivacyNotice } from './guardianQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MinorConsent'>;

/** CANDIDATE UI — see ConsentTierRow.tsx's own header comment. Both tiers always
 * render, in a fixed order (`ConsentTier` has exactly two confirmed values,
 * BASELINE/CAMERA — SKILL.md §14), regardless of whether either has ever been
 * granted.
 *
 * Consent can be given only once (Decisions 171, 172) a School has confirmed this
 * Guardian, and a privacy notice is published; the screen shows the notice the
 * Guardian is agreeing to, and their own consent history (Decision 170). */
export function MinorConsentScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const { data, isLoading, isError, error } = useMyConsentRecords();
  const minors = useMyMinors();
  const notice = usePrivacyNotice();
  const events = useMyConsentEvents();
  const [showNotice, setShowNotice] = useState(false);

  if (isLoading || minors.isLoading || notice.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  // FOUND ON REVIEW: checking `isError` before `data` (same class of bug fixed
  // across every other screen this session) replaced already-loaded consent
  // status with a full-screen error the moment any background refetch
  // failed. Only block on the error when there's genuinely nothing cached.
  if (isError && !data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load consent records — please try again.')} />
      </Screen>
    );
  }

  const activeByTier = new Map(
    (data?.items ?? []).filter((r) => r.studentId === studentId && r.status === 'ACTIVE').map((r) => [r.tier, r]),
  );

  const confirmed = Boolean(minors.data?.items.find((m) => m.studentId === studentId)?.confirmedAt);
  const currentVersion = notice.data?.content ? (notice.data.currentVersion ?? null) : null;
  const policyVersion = currentVersion !== null ? policyVersionOf(currentVersion) : null;
  const blockedReason = !confirmed
    ? `Waiting for ${name}'s school to confirm you as their guardian. Ask the school's front desk — you can give consent once they have.`
    : !policyVersion
      ? 'Consent opens once the privacy notice is published.'
      : null;

  const history = (events.data?.items ?? []).filter((e) => e.studentId === studentId);

  return (
    <Screen>
      <ScrollView>
        <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, marginBottom: spacing[4] }}>{name}</Text>

        {notice.data?.content ? (
          <View style={{ marginBottom: spacing[3] }}>
            <Pressable onPress={() => setShowNotice((s) => !s)} accessibilityRole="button">
              <Text style={{ fontWeight: fontWeight.heading }}>
                {notice.data.title} (version {currentVersion}) {showNotice ? '▲' : '▼'}
              </Text>
            </Pressable>
            {showNotice ? (
              <Text style={{ fontSize: fontSize.caption, marginTop: spacing[2] }}>{notice.data.content}</Text>
            ) : (
              <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>
                Read the privacy notice before you consent.
              </Text>
            )}
          </View>
        ) : null}

        <ConsentTierRow studentId={studentId} tier="BASELINE" record={activeByTier.get('BASELINE')} policyVersion={policyVersion} blockedReason={blockedReason} />
        <ConsentTierRow studentId={studentId} tier="CAMERA" record={activeByTier.get('CAMERA')} policyVersion={policyVersion} blockedReason={blockedReason} />

        {history.length > 0 ? (
          <View style={{ marginTop: spacing[4] }}>
            <Text style={{ fontWeight: fontWeight.heading, marginBottom: spacing[2] }}>Your consent history</Text>
            {history.map((e) => (
              <Text key={e.id} style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginBottom: spacing[1] }}>
                {new Date(e.occurredAt).toLocaleString()} — {e.tier === 'BASELINE' ? 'Baseline' : 'Camera & photo'}{' '}
                {e.type === 'GRANTED' ? 'given' : 'withdrawn'} ({e.policyVersion})
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
