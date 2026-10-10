import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useGradingOverview, useMyRankHistory } from './myGradingQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'GradingHistory'>;

const EVENT_LABEL: Record<string, string> = {
  PROMOTION: 'Promoted',
  BULK_PROMOTION: 'Promoted',
  STRIPE_AWARD: 'Stripe awarded',
  BULK_STRIPE_AWARD: 'Stripe awarded',
  DOWNGRADE: 'Moved down',
  ADJUSTMENT: 'Progress adjusted',
  SELF_DECLARED: 'Belt declared',
  RANK_CORRECTION: 'Belt corrected',
};

/** A student's rank history at one School, newest first, read-only (Decision 155). */
export function GradingHistoryScreen({ route }: Props) {
  const { studentId, schoolId } = route.params;
  const history = useMyRankHistory(studentId, schoolId);
  // Stripe names come with the grading overview (already loaded on the screen before).
  const overview = useGradingOverview(studentId);
  const rungName = useMemo(
    () => new Map((overview.data?.items ?? []).filter((i) => i.schoolId === schoolId).flatMap((i) => i.ladder.map((r) => [r.id, r.name] as const))),
    [overview.data, schoolId],
  );
  const items = history.data?.items ?? [];

  if (history.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (history.error && !history.data) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(history.error, 'Could not load the history — please try again.')} />
      </View>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {items.length === 0 ? <Text style={{ color: theme.textSecondary }}>Nothing yet.</Text> : null}
      {items.map((ev) => (
        <View key={ev.id} style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontWeight: '600' }}>
            {EVENT_LABEL[ev.type] ?? ev.type}
            {ev.toStripeTierId && rungName.get(ev.toStripeTierId) ? `: ${rungName.get(ev.toStripeTierId)}` : ''}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{formatDate(ev.effectiveDate)}</Text>
          {ev.reason ? <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>Reason: {ev.reason}</Text> : null}
          {ev.note ? <Text style={{ fontSize: fontSize.footnote }}>{ev.note}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
