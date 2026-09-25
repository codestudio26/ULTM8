import React from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { ConsentTierRow } from './ConsentTierRow';
import { useMyConsentRecords } from './guardianQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MinorConsent'>;

/** CANDIDATE UI — see ConsentTierRow.tsx's own header comment. Both tiers always
 * render, in a fixed order (`ConsentTier` has exactly two confirmed values,
 * BASELINE/CAMERA — SKILL.md §14), regardless of whether either has ever been
 * granted. */
export function MinorConsentScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const { data, isLoading, isError, error } = useMyConsentRecords();

  if (isLoading) {
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

  return (
    <Screen>
      <ScrollView>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>{name}</Text>
        <ConsentTierRow studentId={studentId} tier="BASELINE" record={activeByTier.get('BASELINE')} />
        <ConsentTierRow studentId={studentId} tier="CAMERA" record={activeByTier.get('CAMERA')} />
      </ScrollView>
    </Screen>
  );
}
