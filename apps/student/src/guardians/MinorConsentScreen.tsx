import React from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { spacing, fontSize, fontWeight } from '../theme/tokens';
import { ConsentTierRow } from './ConsentTierRow';
import { BookingDelegationRow } from './BookingDelegationRow';
import { useMyConsentRecords } from './guardianQueries';
import { useMyBookingDelegations } from './bookingDelegationQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MinorConsent'>;

/** CANDIDATE UI — see ConsentTierRow.tsx's own header comment. Both tiers always
 * render, in a fixed order (`ConsentTier` has exactly two confirmed values,
 * BASELINE/CAMERA — SKILL.md §14), regardless of whether either has ever been
 * granted. */
export function MinorConsentScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const consent = useMyConsentRecords();
  const delegations = useMyBookingDelegations();

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
          message={getApiErrorMessage(consent.error ?? delegations.error, 'Failed to load this minor\'s settings — please try again.')}
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
        <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, marginBottom: spacing[4] }}>{name}</Text>
        <ConsentTierRow studentId={studentId} tier="BASELINE" record={activeByTier.get('BASELINE')} />
        <ConsentTierRow studentId={studentId} tier="CAMERA" record={activeByTier.get('CAMERA')} />
        <BookingDelegationRow studentId={studentId} delegation={activeDelegation} />
      </ScrollView>
    </Screen>
  );
}
