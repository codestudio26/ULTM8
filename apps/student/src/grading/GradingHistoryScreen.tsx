import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useGradingOverview, useMyRankHistory } from './myGradingQueries';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

type Props = NativeStackScreenProps<AppStackParamList, 'GradingHistory'>;

const EVENT_LABEL: Record<string, TranslationKey> = {
  PROMOTION: 'grading.events.promotion',
  BULK_PROMOTION: 'grading.events.promotion',
  STRIPE_AWARD: 'grading.events.stripeAward',
  BULK_STRIPE_AWARD: 'grading.events.stripeAward',
  DOWNGRADE: 'grading.events.downgrade',
  ADJUSTMENT: 'grading.events.adjustment',
  SELF_DECLARED: 'grading.events.selfDeclared',
  RANK_CORRECTION: 'grading.events.rankCorrection',
};

/** A student's rank history at one School, newest first, read-only (Decision 155). */
export function GradingHistoryScreen({ route }: Props) {
  const { studentId, schoolId } = route.params;
  const t = useT();
  const eventLabel = (type: string) => (EVENT_LABEL[type] ? t(EVENT_LABEL[type]!) : type);
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
        <ErrorBanner message={getApiErrorMessage(history.error, t('grading.history.loadError'))} />
      </View>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {items.length === 0 ? <Text style={{ color: theme.textSecondary }}>{t('grading.history.nothingYet')}</Text> : null}
      {items.map((ev) => (
        <View key={ev.id} style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontWeight: '600' }}>
            {ev.toStripeTierId && rungName.get(ev.toStripeTierId)
              ? t('grading.history.eventWithRung', { event: eventLabel(ev.type), rung: rungName.get(ev.toStripeTierId)! })
              : eventLabel(ev.type)}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{formatDate(ev.effectiveDate)}</Text>
          {ev.reason ? <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{t('grading.history.reason', { reason: ev.reason })}</Text> : null}
          {ev.note ? <Text style={{ fontSize: fontSize.footnote }}>{ev.note}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
